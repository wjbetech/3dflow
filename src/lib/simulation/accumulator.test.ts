import { describe, expect, it } from "vitest";
import { advanceAccumulator, createAccumulator } from "./accumulator";

describe("advanceAccumulator", () => {
  it("accumulates and reports whole steps with remainder alpha", () => {
    const acc = createAccumulator();
    const steps = advanceAccumulator(acc, 1 / 60, 1 / 60);

    expect(steps).toBe(1);
    expect(acc.alpha).toBeCloseTo(0, 10);
  });

  it("carries fractional remainder across frames", () => {
    const acc = createAccumulator();
    const dt = 1 / 60;
    const half = dt * 0.5;

    expect(advanceAccumulator(acc, half, dt)).toBe(0);
    expect(acc.alpha).toBeCloseTo(0.5, 10);
    expect(advanceAccumulator(acc, half, dt)).toBe(1);
    expect(acc.alpha).toBeCloseTo(0, 10);
  });

  it("clamps catch-up to maxSubSteps", () => {
    const acc = createAccumulator();

    expect(advanceAccumulator(acc, 1, 1 / 60, 4)).toBe(4);
    expect(acc.accumulator).toBeCloseTo(0, 10);
  });

  it("does not drift alpha outside 0..1", () => {
    const acc = createAccumulator();

    for (let i = 0; i < 200; i += 1) {
      advanceAccumulator(acc, 1 / 61, 1 / 60);
      expect(acc.alpha).toBeGreaterThanOrEqual(0);
      expect(acc.alpha).toBeLessThan(1);
    }
  });
});
