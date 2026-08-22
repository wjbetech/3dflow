import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildIrregularGeometry, customRecipeDefaults, shapePresets, type ShapeRecipe } from "../shapes";
import { computeSpillState } from "./spill";

function tiltAboutX(degrees: number) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(degrees), 0, 0, "XYZ")
  );
}

const upright = new THREE.Quaternion();
const upsideDown = tiltAboutX(180);

describe("computeSpillState", () => {
  it("reports full headroom for an upright vessel", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      const waterVolume = field.fillModel.totalVolume * 0.5;
      const state = computeSpillState(field, upright, waterVolume);

      if (!state) {
        throw new Error("expected spill state for an open vessel");
      }

      expect(state.maxContainedVolume).toBeCloseTo(field.fillModel.totalVolume, 7);
      expect(state.headroomVolume).toBeCloseTo(field.fillModel.totalVolume * 0.5, 7);
      expect(state.spilling).toBe(false);
    } finally {
      field.geometry.dispose();
    }
  });

  it("spills everything when the vessel is upside down", () => {
    const field = buildIrregularGeometry(shapePresets[1]);

    try {
      const state = computeSpillState(field, upsideDown, field.fillModel.totalVolume * 0.4);

      if (!state) {
        throw new Error("expected spill state for an open vessel");
      }

      expect(state.maxContainedVolume).toBeCloseTo(0, 9);
      expect(state.spilling).toBe(true);
    } finally {
      field.geometry.dispose();
    }
  });

  it("reduces contained capacity monotonically as tilt increases", () => {
    const field = buildIrregularGeometry(shapePresets[2]);

    try {
      let previous = Number.POSITIVE_INFINITY;

      for (const degrees of [0, 10, 20, 30, 40, 50, 60]) {
        const state = computeSpillState(field, tiltAboutX(degrees), 0);

        if (!state) {
          throw new Error("expected spill state for an open vessel");
        }

        expect(state.maxContainedVolume).toBeLessThanOrEqual(previous + 1e-12);
        previous = state.maxContainedVolume;
      }

      expect(previous).toBeLessThan(field.fillModel.totalVolume);
    } finally {
      field.geometry.dispose();
    }
  });

  it("marks a filled vessel as spilling once capacity drops below the water volume", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      const fullVolume = field.fillModel.totalVolume;

      for (let degrees = 0; degrees <= 90; degrees += 5) {
        const state = computeSpillState(field, tiltAboutX(degrees), fullVolume);

        if (!state) {
          throw new Error("expected spill state for an open vessel");
        }

        if (degrees > 0) {
          expect(state.spilling).toBe(true);
        }
      }
    } finally {
      field.geometry.dispose();
    }
  });

  it("returns null for sealed vessels without a mouth", () => {
    const sealedRecipe: ShapeRecipe = { ...customRecipeDefaults, mouth: 1 };
    const field = buildIrregularGeometry(sealedRecipe);

    try {
      expect(field.mouthY).toBeNull();
      expect(field.rimPoints).toHaveLength(0);
      expect(computeSpillState(field, upright, 1)).toBeNull();
    } finally {
      field.geometry.dispose();
    }
  });
});
