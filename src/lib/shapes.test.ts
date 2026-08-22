import { describe, expect, it } from "vitest";
import {
  buildIrregularGeometry,
  getFillCutoffY,
  getRecipeById,
  measureIrregularity,
  shapePresets
} from "./shapes";
import { computeSolidMetrics } from "./metrics/solid";

const irregularityThreshold = 7.5;

describe("mouth capping", () => {
  it("builds a watertight capped solid whose capacity matches its integrated volume", () => {
    for (const recipe of shapePresets) {
      const field = buildIrregularGeometry(recipe);

      try {
        expect(field.mouthY).not.toBeNull();
        expect(field.rimPoints.length).toBeGreaterThanOrEqual(9);

        for (let i = 1; i < field.rimPoints.length; i += 3) {
          expect(field.rimPoints[i]).toBeCloseTo(field.mouthY as number, 6);
        }

        const cappedMetrics = computeSolidMetrics(field.cappedGeometry);

        expect(cappedMetrics.volume / field.fillModel.totalVolume).toBeCloseTo(1, 6);
        expect(cappedMetrics.volume).toBeLessThan(field.metrics.volume);
      } finally {
        field.geometry.dispose();
        if (field.cappedGeometry !== field.geometry) {
          field.cappedGeometry.dispose();
        }
      }
    }
  });
});

describe("shape presets", () => {
  it("falls back to the first preset for unknown ids", () => {
    expect(getRecipeById("does-not-exist")).toBe(shapePresets[0]);
  });

  it("measures irregularity deterministically", () => {
    const recipe = shapePresets[0];
    const first = measureIrregularity(recipe);
    const second = measureIrregularity(recipe);

    expect(first).toBeCloseTo(second, 10);
  });
});

describe("irregularity scoring", () => {
  it("classifies every preset as irregular", () => {
    for (const preset of shapePresets) {
      expect(measureIrregularity(preset)).toBeGreaterThanOrEqual(irregularityThreshold);
    }
  });
});

describe("fill volume profile", () => {
  it("maps increasing fill percent to non-decreasing water heights", () => {
    const field = buildIrregularGeometry(shapePresets[1]);

    try {
      let previous = Number.NEGATIVE_INFINITY;

      for (let fillPercent = 0; fillPercent <= 100; fillPercent += 5) {
        const height = getFillCutoffY(field, fillPercent);

        expect(height).toBeGreaterThanOrEqual(previous);
        previous = height;
      }

      expect(previous).toBeLessThanOrEqual(field.bounds.max.y + 0.03);
    } finally {
      field.geometry.dispose();
    }
  });

  it("keeps the water height inside the vessel bounds", () => {
    const field = buildIrregularGeometry(shapePresets[2]);

    try {
      const lowest = getFillCutoffY(field, 50);
      expect(lowest).toBeGreaterThan(field.bounds.min.y);
      expect(lowest).toBeLessThan(field.bounds.max.y);
    } finally {
      field.geometry.dispose();
    }
  });
});
