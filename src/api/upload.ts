import { Request, Response } from "express";
import { upload } from "../storage/fileStore";
import { createJob } from "../db/jobsRepo";
import { imageQueue } from "../queue/jobQueue";
import { v4 as uuidv4 } from "uuid";

export const uploadHandler = [
  upload.single("image"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Image file is required." });
        return;
      }

      const jobId = uuidv4();
      
      const newJob = await createJob({
        jobId,
        filename: req.file.originalname,
        storedFilename: req.file.filename || (req.file as any).key,
        filepath: req.file.path || (req.file as any).location,
        mimetype: req.file.mimetype,
        fileSize: req.file.size
      });

      await imageQueue.add("process-image", { jobId: newJob.jobId }, { jobId: newJob.jobId });

      res.status(200).json({
        jobId: newJob.jobId,
        status: "pending",
        message: "Image uploaded successfully. Processing has been queued."
      });
    } catch (error: any) {
      if (error.message && error.message.includes("Invalid file type")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Internal server error during upload." });
      }
    }
  }
];
