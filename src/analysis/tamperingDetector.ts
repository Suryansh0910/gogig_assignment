import exifr from "exifr";
import { CheckResult } from "../types";

export async function detectTampering(filepath: string): Promise<CheckResult> {
  try {
    let exif: any;
    try {
        exif = await exifr.parse(filepath);
    } catch (e) {
    }

    if (!exif) {
      return {
        name: "tampering_detection",
        passed: true,
        score: 0.8,
        detail: { reason: "No EXIF data found, cannot confirm tampering based on EXIF." }
      };
    }

    let dateInconsistency = false;
    if (exif.DateTimeOriginal && exif.ModifyDate) {
      const original = new Date(exif.DateTimeOriginal).getTime();
      const modified = new Date(exif.ModifyDate).getTime();
      
      if (Math.abs(modified - original) > 60000) { 
        dateInconsistency = true;
      }
    }

    let suspiciousSoftware = false;
    let softwareField = null;
    if (exif.Software) {
      softwareField = String(exif.Software);
      const software = softwareField.toLowerCase();
      const editingTools = ["photoshop", "gimp", "lightroom", "paint.net", "pixelmator"];
      if (editingTools.some(tool => software.includes(tool))) {
        suspiciousSoftware = true;
      }
    }

    const passed = !dateInconsistency && !suspiciousSoftware;
    let score = passed ? 1.0 : (dateInconsistency && suspiciousSoftware ? 0.0 : 0.5);

    return {
      name: "tampering_detection",
      passed,
      score,
      detail: {
        dateInconsistency,
        suspiciousSoftware,
        softwareField
      }
    };
  } catch (error: any) {
    return {
      name: "tampering_detection",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
