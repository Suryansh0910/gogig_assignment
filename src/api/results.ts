import { Request, Response } from "express";
import { getJobById } from "../db/jobsRepo";
import { getResultsForJob } from "../db/resultsRepo";

export const resultsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await getJobById(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.status !== "completed") {
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        message: "Analysis is still in progress. Please poll again."
      });
      return;
    }

    const checks = await getResultsForJob(job.jobId);
    
    const formattedChecks = checks.map(c => ({
      name: c.checkName,
      passed: c.passed,
      score: c.score,
      detail: c.detail
    }));

    const passedChecks = checks.filter(c => c.passed).length;

    const isS3 = job.filepath && (job.filepath.includes(".amazonaws.com") || job.filepath.startsWith("s3://"));

    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      filename: job.filename,
      uploadedAt: job.createdAt,
      completedAt: job.completedAt,
      storageBackend: isS3 ? "s3" : "local",
      storageUrl: isS3 ? job.filepath : null,
      checks: formattedChecks,
      summary: {
        totalChecks: checks.length,
        passed: passedChecks,
        failed: checks.length - passedChecks,
        overallScore: checks.length > 0 ? checks.reduce((acc, c) => acc + (c.score || 0), 0) / checks.length : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};
