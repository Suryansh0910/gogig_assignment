# Intelligent Media Processing Pipeline

> A backend system for asynchronous vehicle image analysis — detecting blur, brightness issues, duplicates, invalid number plates, screenshots, and tampering.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Goals](#goals)
- [Architecture](#architecture)
- [Service & Processing Flow](#service--processing-flow)
- [Queue Strategy](#queue-strategy)
- [API Reference](#api-reference)
- [MongoDB Schema Design](#mongodb-schema-design)
- [Image Analysis Checks](#image-analysis-checks)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Docker Setup](#docker-setup)
- [Sample API Requests & Responses](#sample-api-requests--responses)
- [AI Usage Disclosure](#ai-usage-disclosure)
- [Trade-offs & Design Decisions](#trade-offs--design-decisions)
- [What I Would Improve](#what-i-would-improve)
- [Assumptions Made](#assumptions-made)

---

## Project Overview

This system accepts vehicle images uploaded by field users, processes them asynchronously, and returns structured analysis results. Each uploaded image is checked for quality and validity issues that would make it unsuitable for downstream processing (insurance claims, vehicle registration, fleet management, etc.).

The system is designed around three principles:

- **Reliability** — jobs never silently fail; every failure is recorded with a reason
- **Observability** — every state transition is logged; status is always queryable
- **Separation of concerns** — upload, queuing, analysis, and retrieval are fully decoupled

---

## Goals

| Goal | Description |
|------|-------------|
| Accept image uploads | REST endpoint that validates, stores, and enqueues the image |
| Async processing | Analysis runs in a background worker, not in the request cycle |
| Issue detection | At least 6 meaningful quality and validity checks per image |
| Status tracking | Jobs move through `pending → processing → completed / failed` |
| Structured results | Each check produces a named result with pass/fail, score, and detail |
| Persistence | All jobs and results are stored in MongoDB |

---

## Architecture

```
┌─────────────┐     POST /upload      ┌──────────────────┐
│   Client    │ ──────────────────▶  │   Upload API      │
│             │ ◀──────────────────  │   (Express)       │
│             │    { jobId }          └────────┬─────────┘
└─────────────┘                               │
                                              │ enqueue job
                                              ▼
                                    ┌──────────────────┐
                                    │    Job Queue      │
                                    │  (BullMQ + Redis) │
                                    └────────┬─────────┘
                                             │ dequeue
                                             ▼
                                    ┌──────────────────┐
                                    │  Async Worker     │
                                    │  (BullMQ Worker)  │
                                    └────────┬─────────┘
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                     ▼
               ┌──────────────┐   ┌───────────────────┐  ┌──────────────────┐
               │  Blur Check  │   │  Brightness Check  │  │  OCR / Plate     │
               └──────────────┘   └───────────────────┘  └──────────────────┘
               ┌──────────────┐   ┌───────────────────┐  ┌──────────────────┐
               │  Duplicate   │   │  Screenshot Check  │  │  Tampering Check │
               └──────────────┘   └───────────────────┘  └──────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │   MongoDB     │
                │  (jobs +      │
                │   results)    │
                └───────┬───────┘
                        │
                        ▼
               ┌────────────────┐
               │  Results API   │
               │  GET /jobs/:id │
               └────────────────┘
```

---

## Service & Processing Flow

### Upload flow

1. Client sends `POST /upload` with an image file (multipart/form-data)
2. Upload API validates file type (jpeg/png/webp) and size (max 10MB)
3. Image is saved to local `./uploads/` directory with a UUID filename
4. A job document is inserted into MongoDB with `status: "pending"`
5. Job is pushed onto the BullMQ queue with the job ID
6. API immediately returns `{ jobId, status: "pending" }` — no waiting

### Processing flow

1. BullMQ worker picks up the job from the queue
2. Worker updates job status to `"processing"` in MongoDB
3. All analysis checks run in parallel via `Promise.allSettled()`
4. Each check writes its own result document to MongoDB
5. If all checks complete: job status → `"completed"`
6. If a critical error occurs: job status → `"failed"`, `failureReason` is stored
7. BullMQ automatically retries on worker crash (3 attempts, exponential backoff)

### State machine

```
pending ──▶ processing ──▶ completed
                  │
                  └──▶ failed
```

---

## Queue Strategy

**Choice: BullMQ (backed by Redis)**

BullMQ was chosen over an in-memory queue for the following reasons:

- **Durability** — jobs survive server restarts (Redis persistence)
- **Retry logic** — built-in exponential backoff with configurable attempts
- **Concurrency control** — worker concurrency is a single config value
- **Visibility** — job state (waiting, active, completed, failed) is queryable from Redis
- **No infrastructure overhead** — Redis is the only extra dependency

Queue configuration:

```typescript
const imageQueue = new Queue("image-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,  // keep last 100 completed jobs in Redis
    removeOnFail: 200,
  },
});
```

Worker concurrency is set to `3` by default — enough for local use, configurable via `WORKER_CONCURRENCY` env var.

---

## API Reference

### POST `/upload`

Upload a vehicle image for analysis.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | yes | JPEG, PNG, or WebP image (max 10MB) |

**Response `200`:**

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "pending",
  "message": "Image uploaded successfully. Processing has been queued."
}
```

**Response `400`:**

```json
{
  "error": "Invalid file type. Only JPEG, PNG, and WebP are accepted."
}
```

---

### GET `/jobs/:id/status`

Get the current processing status of a job.

**Response `200`:**

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "processing",
  "createdAt": "2024-09-02T10:30:00.000Z",
  "updatedAt": "2024-09-02T10:30:05.123Z"
}
```

---

### GET `/jobs/:id/results`

Get the full analysis results once a job is completed.

**Response `200`:**

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "completed",
  "filename": "vehicle_front.jpg",
  "uploadedAt": "2024-09-02T10:30:00.000Z",
  "completedAt": "2024-09-02T10:30:08.400Z",
  "checks": [
    {
      "name": "blur_detection",
      "passed": false,
      "score": 0.12,
      "detail": {
        "laplacianVariance": 24.3,
        "threshold": 100,
        "verdict": "Image is too blurry"
      }
    },
    {
      "name": "brightness_analysis",
      "passed": true,
      "score": 0.78,
      "detail": {
        "meanBrightness": 142,
        "verdict": "Brightness is acceptable"
      }
    },
    {
      "name": "ocr_plate_validation",
      "passed": true,
      "score": 0.95,
      "detail": {
        "extractedText": "MH12AB1234",
        "matchesIndianFormat": true,
        "regex": "^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$"
      }
    }
  ],
  "summary": {
    "totalChecks": 6,
    "passed": 5,
    "failed": 1,
    "overallScore": 0.74
  }
}
```

**Response `202`** (job still processing):

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "processing",
  "message": "Analysis is still in progress. Please poll again."
}
```

---

### GET `/jobs/:id/failure`

Get the failure reason for a failed job.

**Response `200`:**

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "failed",
  "failureReason": "Sharp could not decode the image. File may be corrupted.",
  "failedAt": "2024-09-02T10:30:06.200Z"
}
```

---

## MongoDB Schema Design

MongoDB is used as the primary database. Two collections are used.

### Collection: `jobs`

Stores one document per uploaded image.

```typescript
{
  _id: ObjectId,              // MongoDB auto-generated
  jobId: string,              // UUID (used in API responses)
  filename: string,           // original filename from upload
  storedFilename: string,     // UUID-based filename on disk
  filepath: string,           // absolute path to stored file
  mimetype: string,           // "image/jpeg" | "image/png" | "image/webp"
  fileSize: number,           // bytes
  status: "pending" | "processing" | "completed" | "failed",
  failureReason: string | null,
  createdAt: Date,
  updatedAt: Date,
  completedAt: Date | null
}
```

Indexes:

```typescript
{ jobId: 1 }          // unique — primary lookup key
{ status: 1 }         // for filtering by status
{ createdAt: -1 }     // for listing recent jobs
```

### Collection: `analysis_results`

Stores one document per check per job.

```typescript
{
  _id: ObjectId,
  jobId: string,              // FK → jobs.jobId
  checkName: string,          // e.g. "blur_detection"
  passed: boolean,
  score: number | null,       // 0.0 – 1.0 confidence / quality score
  detail: object,             // check-specific structured output
  executedAt: Date
}
```

Indexes:

```typescript
{ jobId: 1 }                  // fetch all checks for a job
{ jobId: 1, checkName: 1 }    // unique — one result per check per job
```

### Why MongoDB

- **Flexible schema** — each analysis check produces a different `detail` shape; MongoDB handles this naturally without nullable columns or JSON blobs in a relational table
- **Document model fits the domain** — a job and its results are a natural document hierarchy
- **Fast reads** — a single indexed query fetches all results for a job
- **No migrations** — adding a new check type does not require a schema change

---

## Image Analysis Checks

Six checks are implemented. Each is a standalone module that receives the image path and returns a `CheckResult`.

### 1. Blur Detection

**Method:** Laplacian variance on grayscale image using `sharp`

A blurry image has low edge intensity. The Laplacian operator amplifies edges; low variance in its output means few strong edges — i.e., a blurry image.

| Score | Meaning |
|-------|---------|
| < 0.3 | Blurry — likely unusable |
| 0.3 – 0.6 | Acceptable |
| > 0.6 | Sharp |

**Threshold:** Laplacian variance < 100 → `passed: false`

---

### 2. Brightness Analysis

**Method:** Mean pixel value of grayscale channel via `sharp.stats()`

Too dark (nighttime, covered lens) or too bright (overexposed, flash glare) makes vehicle details unreadable.

| Mean brightness | Verdict |
|----------------|---------|
| < 40 | Too dark |
| 40 – 210 | Acceptable |
| > 210 | Overexposed |

---

### 3. Duplicate Detection

**Method:** Perceptual hashing (pHash) — compares against hashes of all previously processed images stored in MongoDB

A perceptual hash captures visual structure rather than exact bytes. Two images with hamming distance < 10 are considered duplicates regardless of minor compression differences.

Hashes are stored in the `jobs` collection as a `pHash` field after first computation.

---

### 4. OCR + Indian Number Plate Validation

**Method:** `tesseract.js` for text extraction, regex for format validation

Extracted text is cleaned (remove spaces, lowercase → uppercase) then validated against the Indian vehicle registration format:

```
^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$
```

Examples of valid plates: `MH12AB1234`, `DL4CAF5678`

If no text is detected or the format does not match, `passed: false`.

---

### 5. Screenshot / Photo-of-Photo Detection

**Method:** EXIF metadata inspection via `exifr` + aspect ratio heuristics

Heuristics applied:

- `Software` EXIF field contains known screen capture indicators (e.g. `Screenshot`, `Snagit`, `ShareX`)
- Image dimensions match common screen resolutions (1920×1080, 2560×1440, 375×812, etc.) within ±5%
- Absence of camera-specific EXIF fields (`FocalLength`, `LensModel`, `ExposureTime`) on a JPEG
- Unusually uniform solid-color border detected (photo-of-photo often has a dark frame)

Any two of these heuristics firing → `passed: false`

---

### 6. Tampering / Editing Detection

**Method:** EXIF date inconsistency + JPEG quantization table analysis

Indicators checked:

- `ModifyDate` is significantly later than `DateTimeOriginal` (> 60 seconds difference)
- `Software` EXIF field contains editing tool names (Photoshop, GIMP, Lightroom, Paint.NET)
- GPS coordinates missing on an image that has other complete EXIF data (suggests metadata stripping)
- Non-standard JPEG quantization tables (indicate re-compression after editing)

---

### Check Result Shape

Every check returns:

```typescript
interface CheckResult {
  name: string;
  passed: boolean;
  score: number;        // 0.0 – 1.0
  detail: Record<string, unknown>;
  error?: string;       // populated only if the check itself threw
}
```

Checks run in parallel. If one check throws, it is recorded with `passed: false` and `error` populated — it does not abort the other checks.

---

## Project Structure

```
/
├── src/
│   ├── api/
│   │   ├── upload.ts          # POST /upload
│   │   ├── status.ts          # GET /jobs/:id/status
│   │   ├── results.ts         # GET /jobs/:id/results
│   │   └── failure.ts         # GET /jobs/:id/failure
│   ├── workers/
│   │   └── imageWorker.ts     # BullMQ worker — orchestrates all checks
│   ├── analysis/
│   │   ├── blurDetector.ts
│   │   ├── brightnessAnalyzer.ts
│   │   ├── duplicateDetector.ts
│   │   ├── ocrPlateValidator.ts
│   │   ├── screenshotDetector.ts
│   │   └── tamperingDetector.ts
│   ├── db/
│   │   ├── client.ts          # MongoDB connection singleton
│   │   ├── jobsRepo.ts        # CRUD for jobs collection
│   │   └── resultsRepo.ts     # CRUD for analysis_results collection
│   ├── queue/
│   │   └── jobQueue.ts        # BullMQ queue + worker setup
│   ├── storage/
│   │   └── fileStore.ts       # Multer config + file save logic
│   ├── types/
│   │   └── index.ts           # Shared TypeScript types
│   ├── app.ts                 # Express app + middleware
│   └── server.ts              # Entry point
├── uploads/                   # Uploaded images (gitignored)
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | Node.js + TypeScript | Strong typing, great ecosystem for async I/O |
| HTTP framework | Express | Lightweight, minimal boilerplate |
| Queue | BullMQ | Durable, Redis-backed, built-in retries |
| Cache / Queue backend | Redis | Required by BullMQ; also used for pHash cache |
| Database | MongoDB (via Mongoose) | Flexible schema fits variable check output shapes |
| Image processing | Sharp | Fast native bindings, metadata + pixel stats |
| OCR | Tesseract.js | No external service required, runs locally |
| EXIF parsing | exifr | Lightweight, async, browser + Node compatible |
| File upload | Multer | Standard Express file upload middleware |
| Logging | Pino | Structured JSON logging, low overhead |

---

## Running Locally

### Prerequisites

- Node.js >= 18
- Redis (running locally or via Docker)
- MongoDB (running locally or via Docker)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-username/media-pipeline.git
cd media-pipeline

# 2. Install dependencies
npm install

# 3. Copy environment config
cp .env.example .env
# Edit .env with your MongoDB URI and Redis URL

# 4. Create uploads directory
mkdir -p uploads

# 5. Start the API server
npm run dev

# 6. In a separate terminal, start the worker
npm run worker
```

The API will be available at `http://localhost:3000`.

---

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/media_pipeline

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# File storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=10

# Worker
WORKER_CONCURRENCY=3

# Analysis thresholds (optional overrides)
BLUR_THRESHOLD=100
BRIGHTNESS_MIN=40
BRIGHTNESS_MAX=210
DUPLICATE_HAMMING_DISTANCE=10
```

---

## Docker Setup

```bash
# Start all services (API + Worker + MongoDB + Redis)
docker-compose up --build

# Run in detached mode
docker-compose up -d

# Stop all services
docker-compose down
```

### `docker-compose.yml`

```yaml
version: "3.9"

services:
  api:
    build: .
    command: npm run start
    ports:
      - "3000:3000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/media_pipeline
      - REDIS_HOST=redis
    volumes:
      - ./uploads:/app/uploads
    depends_on:
      - mongo
      - redis

  worker:
    build: .
    command: npm run worker
    environment:
      - MONGODB_URI=mongodb://mongo:27017/media_pipeline
      - REDIS_HOST=redis
    volumes:
      - ./uploads:/app/uploads
    depends_on:
      - mongo
      - redis

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mongo_data:
```

---

## Sample API Requests & Responses

### Upload an image

```bash
curl -X POST http://localhost:3000/upload \
  -F "image=@/path/to/vehicle.jpg"
```

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "pending",
  "message": "Image uploaded successfully. Processing has been queued."
}
```

### Check status

```bash
curl http://localhost:3000/jobs/64f3a1b2c8e4d5f6a7b8c9d0/status
```

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "completed",
  "createdAt": "2024-09-02T10:30:00.000Z",
  "updatedAt": "2024-09-02T10:30:08.400Z"
}
```

### Fetch results

```bash
curl http://localhost:3000/jobs/64f3a1b2c8e4d5f6a7b8c9d0/results
```

```json
{
  "jobId": "64f3a1b2c8e4d5f6a7b8c9d0",
  "status": "completed",
  "filename": "vehicle.jpg",
  "checks": [
    { "name": "blur_detection", "passed": true, "score": 0.82, "detail": { "laplacianVariance": 210.4 } },
    { "name": "brightness_analysis", "passed": true, "score": 0.76, "detail": { "meanBrightness": 138 } },
    { "name": "duplicate_detection", "passed": true, "score": 1.0, "detail": { "isDuplicate": false } },
    { "name": "ocr_plate_validation", "passed": true, "score": 0.94, "detail": { "extractedText": "MH12AB1234", "matchesIndianFormat": true } },
    { "name": "screenshot_detection", "passed": true, "score": 0.91, "detail": { "heuristicsFired": 0 } },
    { "name": "tampering_detection", "passed": false, "score": 0.21, "detail": { "softwareField": "Adobe Photoshop", "dateInconsistency": true } }
  ],
  "summary": {
    "totalChecks": 6,
    "passed": 5,
    "failed": 1,
    "overallScore": 0.77
  }
}
```

---

## AI Usage Disclosure

This project was built with AI assistance. Here is an honest account of where and how.

### Where AI was used

- **Initial scaffolding** — Claude generated the initial Express + BullMQ + TypeScript project structure and boilerplate (app.ts, queue setup, worker skeleton)
- **Analysis check logic** — Claude provided the Laplacian variance approach for blur detection and the pHash comparison algorithm; both were reviewed and threshold values were manually tuned against test images
- **MongoDB schema** — Claude suggested the two-collection design (jobs + analysis_results); the index choices were reviewed and `{ jobId: 1, checkName: 1 }` unique index was added manually after realising duplicates could occur on retries
- **Docker Compose** — Claude generated the initial compose file; the shared `uploads` volume mount between api and worker containers was a fix made after testing revealed the worker couldn't read uploaded files
- **README** — Claude drafted this README based on the assignment specification

### Where AI output was wrong or incomplete

- **Tesseract.js initialization** — AI-generated code used the deprecated `Tesseract.recognize()` callback API; updated to the Promise-based API after checking the current docs
- **Sharp stats() output shape** — AI described `.stats()` returning a `mean` field; actual output nests it under `channels[0].mean`; fixed after testing
- **BullMQ Worker import** — AI used `import { Worker } from 'bull'` (old library); corrected to `import { Worker } from 'bullmq'`

### How AI output was validated

- Every generated function was run against at least two test images before being kept
- Type errors were caught by TypeScript compilation and fixed manually
- The OCR regex was tested against 10 real Indian number plate formats found online

---

## Trade-offs & Design Decisions

| Decision | What was simplified | Reason |
|----------|-------------------|--------|
| Local file storage | Used `./uploads/` on disk instead of S3/GCS | Avoids cloud credentials setup for local evaluation |
| SQLite fallback skipped | MongoDB only — no fallback | Keeping the stack consistent; Mongoose handles connection errors gracefully |
| In-process Tesseract | No dedicated OCR microservice | Simpler deployment; acceptable for the volume expected in this context |
| No auth/rate limiting | No API keys or IP limits | Out of scope for this assignment; noted as a production concern |
| Single worker process | All checks in one Node process | Sufficient for evaluation; production would split into dedicated workers per check type |
| pHash stored in jobs collection | No dedicated hash index store | Simpler schema; a dedicated collection with geospatial-style index would be better at scale |

---

## What I Would Improve

- **Cloud storage** — Replace local `./uploads/` with S3; pass a signed URL to the worker instead of a file path so the system is stateless and horizontally scalable
- **Dedicated check microservices** — Heavy checks (OCR, pHash at scale) could be separate services consuming from topic-specific queues
- **Confidence scoring refinement** — Current scores are heuristic; a calibrated ML model (e.g. a small CNN for blur classification) would produce more reliable scores
- **Rate limiting** — Per-IP and per-API-key limits with Redis-backed counters
- **Dashboard** — A simple polling UI showing job list, status badges, and expandable check results
- **Observability** — Structured Pino logs are a start; adding OpenTelemetry traces would let you see end-to-end latency per check
- **Retry on partial failure** — Currently the whole job fails if the worker crashes mid-check; saving intermediate results and resuming from the last completed check would be more resilient
- **Test coverage** — Unit tests for each analysis module with a fixture image set (sharp, blurry, dark, duplicate, valid plate, no plate)

---

## Assumptions Made

- Uploaded images are expected to be photographs of vehicles; other image types (documents, selfies) are not rejected but will likely fail most checks
- Indian number plate format is the primary validation target (`MH12AB1234` style); other formats are not in scope
- "Duplicate" means visually identical or near-identical — not the same file bytes (perceptual hash, not MD5)
- The system is single-tenant; no user authentication or per-user job isolation is implemented
- Redis and MongoDB are available as external services (not embedded)
- File size limit of 10MB covers typical mobile camera uploads; RAW files are out of scope
- A "failed" job means the worker could not complete analysis (e.g. corrupted file, unreadable image), not that an image failed a quality check — quality check failures are reported inside `checks[]` with `passed: false`
---

## Edge Cases Encountered & Solutions Implemented

### 1. AWS Rekognition Doesn't Support WebP
**Problem:** Images uploaded as `.webp` files returned zero text detections from AWS Rekognition — no error, just an empty result. This was a silent failure that was hard to diagnose.

**Investigation:** Added debug logging to print all Rekognition LINE detections to the worker console. On the next upload, the log showed no output at all, confirming Rekognition was returning empty results rather than throwing an error.

**Solution:** Used `sharp().jpeg().toBuffer()` to convert any image to JPEG bytes in-memory before sending to Rekognition. This happens transparently — the original file in S3 is unchanged.

---

### 2. Duplicate Detection False Positives During Development
**Problem:** The duplicate detector compared every new upload against *all historical jobs in the database forever*. When testing the same image repeatedly, every upload after the first was flagged as a duplicate — making it impossible to test the full pipeline.

**Solution:** Added a configurable `DUPLICATE_WINDOW_DAYS` (default: 7 days) to scope duplicate comparisons to a recent time window. Also created a `npm run db:reset` script (`scripts/reset-db.js`) to clear all jobs between test runs.

**Why this is correct in production:** A vehicle image from 6 months ago should not block a new inspection submission. The window is intentionally configurable so business rules can adjust it without code changes.

---

### 3. OCR Regex Missing Bharat Series (BH) Plates
**Problem:** Our original regex `^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$` only matched traditional state-coded plates (e.g. `MH01AB1234`). India introduced a new **Bharat Series** format (`22BH6517A`) in 2021 for pan-India vehicle registration. This format doesn't have a state prefix.

**Solution:** Updated the regex to support both formats:
```
([A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})
```

---

### 4. AWS Rekognition Detecting Text With Spaces (Breaking Regex Match)
**Problem:** Rekognition returned `"RJ14CV0002 R"` (with a space in the middle) for a license plate. Our regex expected a contiguous string with no spaces, so `RJ14CV0002 R` failed to match even though it was correct.

**Solution:** Strip all whitespace from each Rekognition LINE detection before applying the regex:
```ts
const noSpaces = line.replace(/\s+/g, "");
const match = noSpaces.match(PLATE_REGEX);
```

---

### 5. Hard Image Binarization Destroyed OCR Quality
**Problem:** Applied `sharp().threshold(128)` (hard binary black/white) to preprocess images before OCR, expecting it to improve text contrast. Instead, it produced completely garbled output like `BALYETYEE` — destroying character shapes by forcing every pixel to either pure black or pure white.

**Root Cause:** Tesseract already uses an adaptive Otsu binarization algorithm internally. Applying a hard global threshold before Tesseract removed the gradient information that its internal binarizer relies on.

**Solution:** Removed `.threshold()` entirely. Used only `.greyscale().normalize()` for gentle preprocessing, and switched to AWS Rekognition for production-quality OCR.

---

### 6. Confusing "Score: 100%" on a Failed Duplicate Check
**Problem:** When a duplicate was detected, the UI showed `Score: 100%` with a red "failed" border. This was misleading — a 100% score looks like success.

**Root Cause:** The score formula `1.0 - (hammingDistance / 64)` meant a distance of 0 (exact duplicate) produced a score of 1.0, not 0.0.

**Solution:** Flipped the formula: `score = hammingDistance / 64`. Now an exact duplicate (distance=0) correctly shows `Score: 0%` which is intuitively correct.

---

### 7. Duplicate Index Warning in MongoDB
**Problem:** Mongoose logged a warning on startup: `Duplicate schema index on {"jobId":1}`. This was because `jobId: { unique: true }` in the schema definition already creates an index, and we had also called `jobSchema.index({ jobId: 1 })` separately.

**Solution:** Removed the redundant `jobSchema.index({ jobId: 1 })` call. The `unique: true` option implicitly creates the index.

---

### 8. CI Pipeline Failing Due to Missing Jest TypeScript Types
**Problem:** GitHub Actions CI ran `npm run test` and TypeScript threw errors like `Cannot find name 'expect'` and `Cannot find name 'jest'`, even though tests passed locally.

**Root Cause:** The `tsconfig.json` did not have `"types": ["node", "jest"]`, so the TypeScript compiler in CI didn't know about Jest's global type declarations.

**Solution:** Added `"types": ["node", "jest"]` to `tsconfig.json`. All 3 tests now pass in CI.

