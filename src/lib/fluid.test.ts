import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFluidState, setStaticSurface } from "./fluid";
import { buildIrregularGeometry, getFillCutoffY, shapePresets } from "./shapes";

const fieldStrength = 110;
const isoDensity = 52 / fieldStrength;

describe("setStaticSurface", () => {
  it("fills solid cells below the solved plane and empties those above", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      const state = createFluidState(field, 50, 14);
      const cutoff = getFillCutoffY(field, 50);

      setStaticSurface(state, new THREE.Vector3(0, 1, 0), cutoff, {
        fieldStrength,
        transitionWidth: 0.12
      });

      let saturatedBelow = 0;
      let solidBelow = 0;
      let anyAbove = 0;

      for (let index = 0; index < state.density.length; index += 1) {
        if (state.solid[index] === 0) {
          continue;
        }

        const y = state.cellCenters[index * 3 + 1];

        if (y < cutoff - 0.15) {
          solidBelow += 1;
          if (state.density[index] > 0.95) saturatedBelow += 1;
        } else if (y > cutoff + 0.15) {
          anyAbove += state.density[index];
        }
      }

      expect(solidBelow).toBeGreaterThan(0);
      expect(saturatedBelow / solidBelow).toBeGreaterThan(0.9);
      expect(anyAbove).toBeCloseTo(0, 6);

      const saturatedCount = countDensities(state, (d) => d >= isoDensity - 1e-6);

      expect(Math.abs(saturatedCount - state.targetMass) / Math.max(1, state.targetMass)).toBeLessThan(0.12);
    } finally {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    }
  });

  it("never places density above the vessel mouth", () => {
    const field = buildIrregularGeometry(shapePresets[2]);

    try {
      const state = createFluidState(field, 100, 12);
      const mouthY = field.mouthY as number;

      setStaticSurface(state, new THREE.Vector3(0, 1, 0), mouthY + 5, {
        fieldStrength,
        transitionWidth: 0.12
      });

      for (let index = 0; index < state.density.length; index += 1) {
        const y = state.cellCenters[index * 3 + 1];

        if (y > mouthY + 1e-6) {
          expect(state.solid[index]).toBe(0);
        }
      }
    } finally {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    }
  });

  it("keeps the surface level when the up vector tilts", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      const state = createFluidState(field, 40, 14);
      const tiltedUp = new THREE.Vector3(Math.sin(0.3), Math.cos(0.3), 0).normalize();

      setStaticSurface(state, tiltedUp, 0.1, { fieldStrength, transitionWidth: 0.12 });

      let checked = 0;

      for (let index = 0; index < state.density.length; index += 1) {
        if (state.solid[index] === 0) continue;

        const projection =
          state.cellCenters[index * 3] * tiltedUp.x +
          state.cellCenters[index * 3 + 1] * tiltedUp.y +
          state.cellCenters[index * 3 + 2] * tiltedUp.z;

        if (projection < -0.4) {
          checked += 1;
          expect(state.density[index]).toBeGreaterThan(0.9);
        }
      }

      expect(checked).toBeGreaterThan(10);
    } finally {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    }
  });
});

function countDensities(state: ReturnType<typeof createFluidState>, predicate: (density: number) => boolean) {
  let total = 0;

  for (let index = 0; index < state.density.length; index += 1) {
    if (state.solid[index] !== 0 && predicate(state.density[index])) {
      total += 1;
    }
  }

  return total;
}
