import { ObjectId } from "mongoose";

export interface JobDocument {
  _id?: ObjectId | string;
  jobId: string;
  filename: string;
  storedFilename: string;
  filepath: string;
  mimetype: string;
  fileSize: number;
  status: "pending" | "processing" | "completed" | "failed";
  failureReason: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date | null;
  pHash?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  score: number;
  detail: Record<string, unknown>;
  error?: string;
}

export interface AnalysisResultDocument {
  _id?: ObjectId | string;
  jobId: string;
  checkName: string;
  passed: boolean;
  score: number | null;
  detail: Record<string, unknown>;
  executedAt?: Date;
}
