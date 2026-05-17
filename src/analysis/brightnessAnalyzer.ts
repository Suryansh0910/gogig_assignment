import sharp from "sharp";
import { CheckResult } from "../types";

export async function analyzeBrightness(filepath: string): Promise<CheckResult> {
  const min = parseInt(process.env.BRIGHTNESS_MIN || "40", 10);
  const max = parseInt(process.env.BRIGHTNESS_MAX || "210", 10);

  try {
    const stats = await sharp(filepath).greyscale().stats();
    const meanBrightness = stats.channels[0].mean;

    const passed = meanBrightness >= min && meanBrightness <= max;
    
    let verdict = "Brightness is acceptable";
    if (meanBrightness < min) verdict = "Too dark";
    if (meanBrightness > max) verdict = "Overexposed";

    let score = passed ? 1.0 : 0.0;

    return {
      name: "brightness_analysis",
      passed,
      score,
      detail: {
        meanBrightness,
        verdict
      }
    };
  } catch (error: any) {
    return {
      name: "brightness_analysis",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
