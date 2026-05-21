import { Request, Response } from "express";
import { getAllJobs } from "../db/jobsRepo";
import { getResultsForJob } from "../db/resultsRepo";

export const allJobsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobs = await getAllJobs(50);

    const jobsWithResults = await Promise.all(jobs.map(async (job) => {
      const isS3 = job.filepath && (job.filepath.includes(".amazonaws.com") || job.filepath.startsWith("s3://"));
      let checks: any[] = [];
      let summary = { totalChecks: 0, passed: 0, failed: 0, overallScore: 0 };

      if (job.status === "completed") {
        const results = await getResultsForJob(job.jobId);
        checks = results.map(c => ({
          name: c.checkName,
          passed: c.passed,
          score: c.score,
          detail: c.detail
        }));
        const passed = results.filter(c => c.passed).length;
        summary = {
          totalChecks: results.length,
          passed,
          failed: results.length - passed,
          overallScore: results.length > 0 ? results.reduce((acc, c) => acc + (c.score || 0), 0) / results.length : 0
        };
      }

      return {
        jobId: job.jobId,
        filename: job.filename,
        status: job.status,
        storageBackend: isS3 ? "s3" : "local",
        storageUrl: isS3 ? job.filepath : null,
        uploadedAt: job.createdAt,
        completedAt: job.completedAt,
        failureReason: job.failureReason,
        checks,
        summary
      };
    }));

    res.status(200).json({ jobs: jobsWithResults });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};
