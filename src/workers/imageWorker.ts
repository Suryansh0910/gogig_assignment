import { Worker, Job } from "bullmq";
import { redisConnection } from "../queue/jobQueue";
import { connectDB } from "../db/client";
import { getJobById, updateJobStatus } from "../db/jobsRepo";
import { saveResult } from "../db/resultsRepo";
import { detectBlur } from "../analysis/blurDetector";
import { analyzeBrightness } from "../analysis/brightnessAnalyzer";
import { validateNumberPlate } from "../analysis/ocrPlateValidator";
import { detectScreenshot } from "../analysis/screenshotDetector";
import { detectTampering } from "../analysis/tamperingDetector";
import { detectDuplicate } from "../analysis/duplicateDetector";
import { getResultsForJob } from "../db/resultsRepo";
import pino from "pino";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

dotenv.config();

async function downloadS3File(key: string, localPath: string): Promise<void> {
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  const response = await s3.send(new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: key
  }));

  const fileStream = fs.createWriteStream(localPath);
  if (response.Body instanceof Readable) {
    response.Body.pipe(fileStream);
    return new Promise((resolve, reject) => {
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      fileStream.on("error", reject);
    });
  }
}

const logger = pino({ name: "worker" });

async function processImage(job: Job) {
  const { jobId } = job.data;
  
  const jobDoc = await getJobById(jobId);
  if (!jobDoc) {
    throw new Error(`Job document not found for ID: ${jobId}`);
  }

  await updateJobStatus(jobId, "processing");

  try {
    let filepath = jobDoc.filepath;
    let isTemp = false;

    if (filepath.startsWith("http")) {
      const tempPath = path.join(os.tmpdir(), `${jobId}${path.extname(jobDoc.filename)}`);
      await downloadS3File(jobDoc.storedFilename, tempPath);
      filepath = tempPath;
      isTemp = true;
    }

    const existingResults = await getResultsForJob(jobId);
    const completedChecks = new Set(existingResults.filter(r => r.passed).map(r => r.checkName));

    const allChecks = [
      { name: "blur_detection", fn: () => detectBlur(filepath) },
      { name: "brightness_analysis", fn: () => analyzeBrightness(filepath) },
      { name: "ocr_plate_validation", fn: () => validateNumberPlate(filepath) },
      { name: "screenshot_detection", fn: () => detectScreenshot(filepath) },
      { name: "tampering_detection", fn: () => detectTampering(filepath) },
      { name: "duplicate_detection", fn: () => detectDuplicate(filepath, jobId) }
    ];

    const pendingChecks = allChecks.filter(c => !completedChecks.has(c.name));
    
    logger.info({ jobId, pendingCount: pendingChecks.length }, "Running pending checks");

    const results = await Promise.allSettled(pendingChecks.map(c => c.fn()));

    for (const result of results) {
      if (result.status === "fulfilled") {
        await saveResult({
          jobId,
          checkName: result.value.name,
          passed: result.value.passed,
          score: result.value.score,
          detail: result.value.detail,
          executedAt: new Date()
        });
      } else {
        logger.error({ err: result.reason, jobId }, "Check failed unexpectedly");
      }
    }

    await updateJobStatus(jobId, "completed", { completedAt: new Date() });
    
    if (isTemp) {
      fs.unlinkSync(filepath);
    }
    logger.info({ jobId }, "Job completed successfully");

  } catch (error: any) {
    logger.error({ err: error, jobId }, "Critical failure processing job");
    await updateJobStatus(jobId, "failed", { failureReason: error.message });
    throw error;
  }
}

async function startWorker() {
  await connectDB();
  
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || "3", 10);

  const worker = new Worker("image-processing", processImage, {
    connection: redisConnection,
    concurrency
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.data.jobId }, "Worker finished job");
  });

  worker.on("failed", (job, err) => {
    if (job) {
        logger.error({ jobId: job.data.jobId, err }, "Worker failed job");
    } else {
        logger.error({ err }, "Worker error");
    }
  });

  logger.info("Worker started and listening for jobs...");
}

if (require.main === module) {
  startWorker();
}
