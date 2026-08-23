import { describe, expect, it } from "vitest";
import { runDamBreakConservation, runSloshPeriod } from "./validation";

describe("validation", () => {
  it("conserves particles in dam break", () => {
    const r = runDamBreakConservation();
    expect(r.passed).toBe(true);
  });
  it("slosh stays bounded", () => {
    const r = runSloshPeriod();
    expect(r.passed).toBe(true);
  });
});
