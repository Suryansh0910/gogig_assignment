import mongoose, { Schema } from "mongoose";
import { AnalysisResultDocument } from "../types";

const analysisResultSchema = new Schema<AnalysisResultDocument>({
  jobId: { type: String, required: true },
  checkName: { type: String, required: true },
  passed: { type: Boolean, required: true },
  score: { type: Number, default: null },
  detail: { type: Schema.Types.Mixed, default: {} },
  executedAt: { type: Date, default: Date.now }
});

analysisResultSchema.index({ jobId: 1 });
analysisResultSchema.index({ jobId: 1, checkName: 1 }, { unique: true });

export const AnalysisResultModel = mongoose.model<AnalysisResultDocument>("AnalysisResult", analysisResultSchema);

export async function saveResult(data: AnalysisResultDocument): Promise<AnalysisResultDocument> {
  await AnalysisResultModel.updateOne(
    { jobId: data.jobId, checkName: data.checkName },
    { $set: data },
    { upsert: true }
  );
  return data;
}

export async function getResultsForJob(jobId: string): Promise<AnalysisResultDocument[]> {
  return AnalysisResultModel.find({ jobId }).lean();
}
