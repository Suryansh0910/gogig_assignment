import { analyzeBrightness } from "../brightnessAnalyzer";
import sharp from "sharp";

jest.mock("sharp");

describe("Brightness Analyzer", () => {
  beforeEach(() => {
    process.env.BRIGHTNESS_MIN = "40";
    process.env.BRIGHTNESS_MAX = "210";
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should pass an image with acceptable brightness", async () => {
    const mockStats = { channels: [{ mean: 120 }] };
    const mockGreyscale = jest.fn().mockReturnThis();
    const mockStatsFn = jest.fn().mockResolvedValue(mockStats);
    
    (sharp as unknown as jest.Mock).mockImplementation(() => ({
      greyscale: mockGreyscale,
      stats: mockStatsFn,
    }));

    const result = await analyzeBrightness("fake_image.jpg");

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.detail.verdict).toBe("Brightness is acceptable");
  });

  it("should fail an image that is too dark", async () => {
    const mockStats = { channels: [{ mean: 20 }] };
    (sharp as unknown as jest.Mock).mockImplementation(() => ({
      greyscale: jest.fn().mockReturnThis(),
      stats: jest.fn().mockResolvedValue(mockStats),
    }));

    const result = await analyzeBrightness("dark_image.jpg");

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.detail.verdict).toBe("Too dark");
  });

  it("should handle sharp execution errors safely", async () => {
    (sharp as unknown as jest.Mock).mockImplementation(() => ({
      greyscale: jest.fn().mockReturnThis(),
      stats: jest.fn().mockRejectedValue(new Error("Corrupted file")),
    }));

    const result = await analyzeBrightness("corrupt_image.jpg");

    expect(result.passed).toBe(false);
    expect(result.error).toBe("Corrupted file");
  });
});
