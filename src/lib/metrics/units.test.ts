import { describe, expect, it } from "vitest";
import {
  centimetersPerSceneUnit,
  cubicUnitsToLiters,
  formatLength,
  formatVolume,
  litersPerCubicSceneUnit,
  sceneUnitsToCentimeters
} from "./units";

describe("scene unit calibration", () => {
  it("maps one cubic scene unit to exactly one liter", () => {
    expect(centimetersPerSceneUnit).toBe(10);
    expect(litersPerCubicSceneUnit).toBeCloseTo(1, 12);
    expect(cubicUnitsToLiters(7.6)).toBeCloseTo(7.6, 12);
  });

  it("converts lengths to centimeters", () => {
    expect(sceneUnitsToCentimeters(2.44)).toBeCloseTo(24.4, 12);
  });
});

describe("formatters", () => {
  it("formats liters above one liter", () => {
    expect(formatVolume(7.604)).toBe("7.60 L");
    expect(formatVolume(1)).toBe("1.00 L");
  });

  it("formats milliliters below one liter", () => {
    expect(formatVolume(0.5)).toBe("500 ml");
    expect(formatVolume(0.0384)).toBe("38 ml");
    expect(formatVolume(0)).toBe("0 ml");
  });

  it("falls back to a dash for non-finite input", () => {
    expect(formatVolume(Number.NaN)).toBe("—");
    expect(formatLength(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats lengths with one decimal", () => {
    expect(formatLength(13.26)).toBe("13.3 cm");
    expect(formatLength(0)).toBe("0.0 cm");
  });
});
