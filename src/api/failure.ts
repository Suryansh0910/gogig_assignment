import { Request, Response } from "express";
import { getJobById } from "../db/jobsRepo";

export const failureHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await getJobById(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.status !== "failed") {
      res.status(400).json({ error: "Job has not failed." });
      return;
    }

    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      failureReason: job.failureReason,
      failedAt: job.updatedAt 
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};
