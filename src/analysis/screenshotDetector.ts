import exifr from "exifr";
import sharp from "sharp";
import { CheckResult } from "../types";

export async function detectScreenshot(filepath: string): Promise<CheckResult> {
  try {
    let heuristicsFired = 0;
    
    let exif: any;
    try {
        exif = await exifr.parse(filepath);
    } catch (e) {
    }

    if (exif && exif.Software) {
      const software = String(exif.Software).toLowerCase();
      if (software.includes("screenshot") || software.includes("snagit") || software.includes("sharex")) {
        heuristicsFired++;
      }
    }

    if (filepath.toLowerCase().endsWith(".jpg") || filepath.toLowerCase().endsWith(".jpeg")) {
       if (!exif || (!exif.FocalLength && !exif.LensModel && !exif.ExposureTime)) {
           heuristicsFired++;
       }
    }

    const metadata = await sharp(filepath).metadata();
    if (metadata.width && metadata.height) {
      const commonResolutions = [
        { w: 1920, h: 1080 },
        { w: 1080, h: 1920 },
        { w: 2560, h: 1440 },
        { w: 1440, h: 2560 },
        { w: 375, h: 812 },
        { w: 812, h: 375 },
      ];

      const matchesResolution = commonResolutions.some(res => {
        const wDiff = Math.abs(metadata.width! - res.w) / res.w;
        const hDiff = Math.abs(metadata.height! - res.h) / res.h;
        return wDiff <= 0.05 && hDiff <= 0.05;
      });

      if (matchesResolution) {
        heuristicsFired++;
      }
    }

    const passed = heuristicsFired < 2;

    return {
      name: "screenshot_detection",
      passed,
      score: passed ? 1.0 : 0.0,
      detail: {
        heuristicsFired,
        software: exif?.Software || null,
        dimensions: metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : null
      }
    };
  } catch (error: any) {
    return {
      name: "screenshot_detection",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
