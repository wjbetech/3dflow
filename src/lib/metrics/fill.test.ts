import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildIrregularGeometry, getFillCutoffY, shapePresets } from "../shapes";
import { computeSolidMetrics } from "./solid";
import { createFillModel } from "./fill";

describe("fillModel on analytic primitives", () => {
  it("reproduces the exact fill ramp of a unit cube", () => {
    const model = createFillModel(new THREE.BoxGeometry(1, 1, 1));

    expect(model.totalVolume).toBeCloseTo(1, 10);
    expect(model.volumeBelow(-10)).toBeCloseTo(0, 12);
    expect(model.volumeBelow(-0.5)).toBeCloseTo(0, 9);
    expect(model.volumeBelow(-0.25)).toBeCloseTo(0.25, 9);
    expect(model.volumeBelow(0)).toBeCloseTo(0.5, 9);
    expect(model.volumeBelow(0.31)).toBeCloseTo(0.81, 9);
    expect(model.volumeBelow(0.5)).toBeCloseTo(1, 9);
    expect(model.volumeBelow(10)).toBeCloseTo(1, 12);
  });

  it("reproduces the exact fill ramp of a faceted cylinder with flat caps", () => {
    const segments = 64;
    const baseArea = (segments / 2) * Math.sin((Math.PI * 2) / segments);
    const model = createFillModel(new THREE.CylinderGeometry(1, 1, 2, segments));

    for (const height of [-1, -0.75, -0.2, 0, 0.437, 1]) {
      const actual = model.volumeBelow(height);
      const linearExpectation =
        model.totalVolume * (THREE.MathUtils.clamp(height + 1, 0, 2) / 2);

      if (linearExpectation === 0) {
        expect(actual).toBeCloseTo(0, 12);
      } else {
        expect(Math.abs(actual - linearExpectation)).toBeLessThan(
          1e-9 * Math.max(1, linearExpectation)
        );
      }
    }

    expect(model.totalVolume / (baseArea * 2)).toBeCloseTo(1, 7);
  });

  it("integrates a single signed tetrahedron exactly across its interior origin knot", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([1, -1, 0, 0, 1, 0, 0, 0, 1], 3)
    );
    const model = createFillModel(geometry);

    expect(model.totalVolume).toBeCloseTo(1 / 6, 12);

    const belowKnot = (height: number) => ((height + 1) ** 3) / 12;
    const aboveKnot = (height: number) => 1 / 6 - ((1 - height) ** 3) / 12;

    expect(model.volumeBelow(-1)).toBeCloseTo(0, 11);

    for (const height of [-0.75, -0.5, -0.25, -0.05]) {
      expect(model.volumeBelow(height)).toBeCloseTo(belowKnot(height), 11);
    }

    expect(model.volumeBelow(0)).toBeCloseTo(1 / 12, 11);

    for (const height of [0.05, 0.4, 0.6, 0.9]) {
      expect(model.volumeBelow(height)).toBeCloseTo(aboveKnot(height), 11);
    }

    expect(model.volumeBelow(1)).toBeCloseTo(1 / 6, 11);
    expect(model.volumeBelow(5)).toBeCloseTo(1 / 6, 11);
  });

  it("matches analytic spherical cap volumes within tessellation error", () => {    const model = createFillModel(new THREE.SphereGeometry(1, 96, 64));
    const capVolume = (t: number) => (Math.PI * t * t * (3 - t)) / 3;

    for (const height of [-0.6, -0.2, 0.15, 0.7]) {
      const expected = capVolume(height + 1);
      const actual = model.volumeBelow(height);

      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.005);
    }
  });

  it("keeps the mirror identity for solids centered on the xz-plane", () => {
    const model = createFillModel(new THREE.SphereGeometry(1, 96, 64));

    for (const height of [-0.55, -0.1, 0.23, 0.68]) {
      const mirrored = model.totalVolume - model.volumeBelow(-height);

      expect(model.volumeBelow(height)).toBeCloseTo(mirrored, 8);
    }
  });
});

describe("fillModel on irregular vessels", () => {
  it("agrees with solid metrics at the top of the range and stays monotone", () => {
    for (const recipe of shapePresets) {
      const field = buildIrregularGeometry(recipe);

      try {
        const metrics = computeSolidMetrics(field.geometry);
        const model = field.fillModel;

        expect(model.totalVolume / metrics.volume).toBeCloseTo(1, 9);

        let previous = -1;

        for (let step = 0; step <= 40; step += 1) {
          const height = model.minHeight + ((model.maxHeight - model.minHeight) * step) / 40;
          const volume = model.volumeBelow(height);

          expect(volume).toBeGreaterThanOrEqual(previous);
          previous = volume;
        }
      } finally {
        field.geometry.dispose();
      }
    }
  });

  it("builds identical models for identical recipes", () => {
    const firstField = buildIrregularGeometry(shapePresets[0]);
    const secondField = buildIrregularGeometry(shapePresets[0]);

    try {
      for (const height of [firstField.fillModel.minHeight + 0.3, 0, firstField.fillModel.maxHeight - 0.3]) {
        expect(firstField.fillModel.volumeBelow(height)).toBe(
          secondField.fillModel.volumeBelow(height)
        );
      }
    } finally {
      firstField.geometry.dispose();
      secondField.geometry.dispose();
    }
  });

  it("inverts fill percent into a height holding the requested volume", () => {
    for (const recipe of [shapePresets[0], shapePresets[2]]) {
      const field = buildIrregularGeometry(recipe);

      try {
        for (const fillPercent of [5, 25, 50, 78, 95]) {
          const height = getFillCutoffY(field, fillPercent);
          const fraction =
            field.fillModel.volumeBelow(height) / field.fillModel.totalVolume;

          expect(Math.abs(fraction - fillPercent / 100)).toBeLessThan(0.005);
        }
      } finally {
        field.geometry.dispose();
      }
    }
  });
});

describe("submerged centroid", () => {
  it("returns null for an empty submerged region", () => {
    const model = createFillModel(new THREE.BoxGeometry(1, 1, 1));

    expect(model.centroidBelow(-5)).toBeNull();
  });

  it("matches closed-form centroids for a unit cube", () => {
    const model = createFillModel(new THREE.BoxGeometry(1, 1, 1));

    for (const height of [-0.3, 0, 0.22]) {
      const result = model.centroidBelow(height);

      if (!result) {
        throw new Error(`expected submerged region at ${height}`);
      }

      const expectedY = (height - 0.5) / 2;

      expect(result.volume).toBeCloseTo(height + 0.5, 9);
      expect(result.centroid.x).toBeCloseTo(0, 8);
      expect(result.centroid.y).toBeCloseTo(expectedY, 8);
      expect(result.centroid.z).toBeCloseTo(0, 8);
    }

    expect(model.centroidBelow(10)?.centroid.y).toBeCloseTo(0, 9);
  });

  it("matches homothetic closed forms across the synthetic tetrahedron knot", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([1, -1, 0, 0, 1, 0, 0, 0, 1], 3)
    );
    const model = createFillModel(geometry);

    for (const height of [-0.7, -0.3, -0.05]) {
      const result = model.centroidBelow(height);

      if (!result) {
        throw new Error(`expected submerged region at ${height}`);
      }

      const m = height + 1;

      expect(result.volume / (m ** 3 / 12)).toBeCloseTo(1, 10);
      expect(result.centroid.x).toBeCloseTo(1 - (5 * m) / 8, 9);
      expect(result.centroid.y).toBeCloseTo(-1 + (3 * m) / 4, 9);
      expect(result.centroid.z).toBeCloseTo(m / 4, 9);
    }

    for (const height of [0.2, 0.55, 0.85]) {
      const result = model.centroidBelow(height);

      if (!result) {
        throw new Error(`expected submerged region at ${height}`);
      }

      const s = 1 - height;
      const aboveVolume = s ** 3 / 12;
      const belowVolume = 1 / 6 - aboveVolume;
      const aboveCentroid = [s / 8, 1 - (3 * s) / 4, s / 4];
      const totalCentroid = [0.25, 0, 0.25];

      const expected = totalCentroid.map(
        (component, axis) => (component * (1 / 6) - aboveCentroid[axis] * aboveVolume) / belowVolume
      );

      expect(result.volume / belowVolume).toBeCloseTo(1, 10);
      expect(result.centroid.x).toBeCloseTo(expected[0], 9);
      expect(result.centroid.y).toBeCloseTo(expected[1], 9);
      expect(result.centroid.z).toBeCloseTo(expected[2], 9);
    }
  });

  it("keeps symmetric vessels symmetric and bounds the fluid centroid", () => {
    const model = createFillModel(new THREE.SphereGeometry(1, 96, 64));

    for (const height of [-0.6, -0.1, 0.4]) {
      const result = model.centroidBelow(height);

      if (!result) {
        throw new Error(`expected submerged region at ${height}`);
      }

      expect(Math.abs(result.centroid.x)).toBeLessThan(1e-6);
      expect(Math.abs(result.centroid.z)).toBeLessThan(1e-6);
      expect(result.centroid.y).toBeGreaterThan(-1);
      expect(result.centroid.y).toBeLessThan(height);
    }
  });

  it("produces bounded centroids inside irregular vessels while filling", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      for (const fillPercent of [10, 40, 70, 95]) {
        const height = getFillCutoffY(field, fillPercent);
        const result = field.fillModel.centroidBelow(height);

        if (!result) {
          throw new Error(`expected submerged region at fill ${fillPercent}`);
        }

        expect(Math.abs(result.volume / field.fillModel.totalVolume - fillPercent / 100)).toBeLessThan(
          0.005
        );
        expect(result.centroid.length()).toBeLessThan(2);
        expect(result.centroid.y).toBeGreaterThanOrEqual(field.bounds.min.y - 1e-6);
        expect(result.centroid.y).toBeLessThanOrEqual(height + 1e-6);
      }
    } finally {
      field.geometry.dispose();
    }
  });
});
