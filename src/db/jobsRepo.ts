import mongoose, { Schema } from "mongoose";
import { JobDocument } from "../types";

const jobSchema = new Schema<JobDocument>({
  jobId: { type: String, required: true, unique: true },
  filename: { type: String, required: true },
  storedFilename: { type: String, required: true },
  filepath: { type: String, required: true },
  mimetype: { type: String, required: true },
  fileSize: { type: Number, required: true },
  status: { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
  failureReason: { type: String, default: null },
  completedAt: { type: Date, default: null },
  pHash: { type: String }
}, {
  timestamps: true // adds createdAt, updatedAt
});

// Note: jobId index is created automatically via unique:true above
jobSchema.index({ status: 1 });
jobSchema.index({ createdAt: -1 });

export const JobModel = mongoose.model<JobDocument>("Job", jobSchema);

export async function createJob(data: Omit<JobDocument, "status" | "failureReason">): Promise<JobDocument> {
  const job = new JobModel(data);
  await job.save();
  return job.toObject();
}

export async function getJobById(jobId: string): Promise<JobDocument | null> {
  return JobModel.findOne({ jobId }).lean();
}

export async function updateJobStatus(jobId: string, status: JobDocument["status"], additionalData?: Partial<JobDocument>): Promise<JobDocument | null> {
  return JobModel.findOneAndUpdate(
    { jobId },
    { $set: { status, ...additionalData } },
    { new: true }
  ).lean();
}

export async function getAllJobs(limit = 50): Promise<JobDocument[]> {
  return JobModel.find({ status: { $in: ["completed", "failed"] } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
