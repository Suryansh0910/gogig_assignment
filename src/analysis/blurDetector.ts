import sharp from "sharp";
import { CheckResult } from "../types";

export async function detectBlur(filepath: string): Promise<CheckResult> {
  const threshold = parseInt(process.env.BLUR_THRESHOLD || "100", 10);
  try {
    const laplacianKernel: sharp.Kernel = {
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    };

    const image = sharp(filepath).greyscale();
    
    const { data } = await image.convolve(laplacianKernel).raw().toBuffer({ resolveWithObject: true });
    
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const mean = sum / data.length;

    let varianceSum = 0;
    for (let i = 0; i < data.length; i++) {
      varianceSum += Math.pow(data[i] - mean, 2);
    }
    const variance = varianceSum / data.length;

    const passed = variance >= threshold;
    let score = passed ? Math.min(1.0, variance / (threshold * 3)) : Math.max(0, variance / threshold);

    return {
      name: "blur_detection",
      passed,
      score,
      detail: {
        laplacianVariance: variance,
        threshold,
        verdict: passed ? "Sharp" : "Image is too blurry"
      }
    };
  } catch (error: any) {
    return {
      name: "blur_detection",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
