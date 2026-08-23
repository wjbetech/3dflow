import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildIrregularGeometry,
  getDirectionalRadius,
  getFillCutoffY,
  getRecipeById,
  measureIrregularity,
  shapePresets,
  type ShapeRecipe
} from "./shapes";
import { computeSolidMetrics } from "./metrics/solid";

function closestVertexDistance(
  geometry: THREE.BufferGeometry,
  target: [number, number, number]
) {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  let best = Number.POSITIVE_INFINITY;
  let bestIndex = -1;

  for (let i = 0; i < positions.count; i += 1) {
    const distance = Math.hypot(
      positions.getX(i) - target[0],
      positions.getY(i) - target[1],
      positions.getZ(i) - target[2]
    );

    if (distance < best) {
      best = distance;
      bestIndex = i;
    }
  }

  return { distance: best, index: bestIndex };
}

function farSculptedHelper(positions: THREE.BufferAttribute, index: number) {  return `${positions.getX(index)}|${positions.getY(index)}|${positions.getZ(index)}`;
}

describe("surface deformations", () => {
  const baseRecipe: ShapeRecipe = {
    ...shapePresets[0],
    mouth: 1,
    stretch: { x: 0, y: 0, z: 0 },
    deformations: []
  };

  const anchorDirection = new THREE.Vector3(1, -0.44, 0).normalize();
  const anchorRadius = getDirectionalRadius(baseRecipe, anchorDirection);
  const deformationOrigin: [number, number, number] = [
    anchorDirection.x * anchorRadius,
    anchorDirection.y * anchorRadius,
    anchorDirection.z * anchorRadius
  ];
  const deformationDisplacement: [number, number, number] = [0.35, 0.25, -0.2];
  const deformationRadius = 0.5;

  const sculptedRecipe: ShapeRecipe = {
    ...baseRecipe,
    deformations: [
      {
        origin: deformationOrigin,
        displacement: deformationDisplacement,
        radius: deformationRadius
      }
    ]
  };

  it("moves the anchor vertex by the full displacement and leaves distant vertices fixed", () => {
    const base = buildIrregularGeometry({ ...sculptedRecipe, deformations: [] });
    const sculpted = buildIrregularGeometry(sculptedRecipe);

    try {
      const near = closestVertexDistance(base.cappedGeometry, deformationOrigin);
      const basePosition = base.cappedGeometry.getAttribute("position") as THREE.BufferAttribute;
      const sculptedPosition = sculpted.cappedGeometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;

      expect(near.distance).toBeLessThan(0.06);

      const moved = new THREE.Vector3(
        sculptedPosition.getX(near.index) - basePosition.getX(near.index),
        sculptedPosition.getY(near.index) - basePosition.getY(near.index),
        sculptedPosition.getZ(near.index) - basePosition.getZ(near.index)
      );

      expect(moved.x).toBeCloseTo(deformationDisplacement[0], 2);
      expect(moved.y).toBeCloseTo(deformationDisplacement[1], 2);
      expect(moved.z).toBeCloseTo(deformationDisplacement[2], 2);

      const far = closestVertexDistance(base.cappedGeometry, [0, 1.3, 0]);

      expect(farSculptedHelper(sculptedPosition, far.index)).toBe(
        farSculptedHelper(basePosition, far.index)
      );
    } finally {
      base.geometry.dispose();
      base.cappedGeometry.dispose();
      sculpted.geometry.dispose();
      sculpted.cappedGeometry.dispose();
    }
  });

  it("keeps a strongly sculpted solid watertight and self-consistent", () => {
    const field = buildIrregularGeometry({
      ...baseRecipe,
      deformations: [
        {
          origin: deformationOrigin,
          displacement: deformationDisplacement,
          radius: deformationRadius
        },
        {
          origin: [-0.7, 0.6, 0.3],
          displacement: [-0.4, -0.1, 0.25],
          radius: 0.6
        }
      ]
    });

    try {
      const cappedMetrics = computeSolidMetrics(field.cappedGeometry);

      expect(cappedMetrics.volume).toBeGreaterThan(0);
      expect(cappedMetrics.volume / field.fillModel.totalVolume).toBeCloseTo(1, 6);
    } finally {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    }
  });
});

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

        const positionCount = field.cappedGeometry.getAttribute("position").count;
        const lidCount = positionCount - field.lidVertexStart;

        expect(field.lidVertexStart).toBeGreaterThan(0);
        expect(field.lidVertexStart % 3).toBe(0);
        expect(lidCount).toBeGreaterThan(0);
        expect(lidCount % 3).toBe(0);

        const cappedPositions = field.cappedGeometry.getAttribute("position");

        for (let i = field.lidVertexStart; i < positionCount; i += 1) {
          expect(cappedPositions.getY(i)).toBeCloseTo(field.mouthY as number, 6);
        }

        expect(field.cappedGeometry.groups.length).toBe(2);
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
      const field = buildIrregularGeometry(preset);

      try {
        expect(field.irregularityReport.irregular).toBe(true);
        expect(field.irregularityReport.failedLabels.length).toBeGreaterThan(0);
      } finally {
        field.geometry.dispose();
        if (field.cappedGeometry !== field.geometry) {
          field.cappedGeometry.dispose();
        }
      }
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
