import sharp from "sharp";
import { CheckResult } from "../types";
import { JobModel } from "../db/jobsRepo";

async function computePHash(filepath: string): Promise<string> {
  const size = 8;
  const { data } = await sharp(filepath)
    .resize(size, size, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const mean = sum / data.length;

  let hash = "";
  for (let i = 0; i < data.length; i++) {
    hash += data[i] >= mean ? "1" : "0";
  }
  return hash;
}

function hammingDistance(h1: string, h2: string): number {
  let distance = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) distance++;
  }
  return distance;
}

export async function detectDuplicate(filepath: string, currentJobId: string): Promise<CheckResult> {
  const threshold = parseInt(process.env.DUPLICATE_HAMMING_DISTANCE || "10", 10);
  const windowDays = parseInt(process.env.DUPLICATE_WINDOW_DAYS || "7", 10);
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  
  try {
    const pHash = await computePHash(filepath);
    
    await JobModel.updateOne({ jobId: currentJobId }, { $set: { pHash } });

    // Only compare against jobs uploaded within the time window
    const otherJobs = await JobModel.find({ 
      jobId: { $ne: currentJobId }, 
      pHash: { $exists: true, $ne: null },
      createdAt: { $gte: windowStart }
    }).select("jobId pHash").lean();

    let isDuplicate = false;
    let minDistance = 64; 
    let duplicateJobId = null;

    for (const job of otherJobs) {
      if (job.pHash) {
        const distance = hammingDistance(pHash, job.pHash);
        if (distance < minDistance) {
            minDistance = distance;
            duplicateJobId = job.jobId;
        }
        if (distance < threshold) {
          isDuplicate = true;
          break; 
        }
      }
    }

    const passed = !isDuplicate;

    return {
      name: "duplicate_detection",
      passed,
      score: passed ? 1.0 : (minDistance / 64), // Low score = very similar / definite duplicate
      detail: {
        isDuplicate,
        minDistance: isDuplicate ? minDistance : null,
        duplicateJobId: isDuplicate ? duplicateJobId : null
      }
    };
  } catch (error: any) {
    return {
      name: "duplicate_detection",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
