import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildIrregularGeometry,
  customRecipeDefaults,
  getDirectionalRadius,
  shapePresets,
  type ShapeRecipe
} from "../shapes";
import { computeSolidMetrics } from "./solid";

function buildIndexedTetrahedron() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        1, 0, 0,
        0, 0, 0,
        0, 1, 0,
        0, 1, 0,
        0, 0, 0,
        0, 0, 1,
        0, 0, 1,
        0, 0, 0,
        1, 0, 0
      ],
      3
    )
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return geometry;
}

function buildNonIndexedTetrahedron() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        1, 0, 0,
        0, 0, 0,
        0, 1, 0,
        0, 1, 0,
        0, 0, 0,
        0, 0, 1,
        0, 0, 1,
        0, 0, 0,
        1, 0, 0
      ],
      3
    )
  );
  return geometry;
}

const quadratureRecipe: ShapeRecipe = {
  ...customRecipeDefaults,
  id: "quadrature-fixture",
  stretch: { x: 0, y: 0, z: 0 }
};

function quadratureVolume(recipe: ShapeRecipe, thetaSteps: number, phiSteps: number) {
  const thetaStep = Math.PI / thetaSteps;
  const phiStep = (Math.PI * 2) / phiSteps;
  let total = 0;
  const direction = new THREE.Vector3();

  for (let i = 0; i < thetaSteps; i += 1) {
    const theta = (i + 0.5) * thetaStep;

    for (let j = 0; j < phiSteps; j += 1) {
      const phi = (j + 0.5) * phiStep;
      direction.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const radius = getDirectionalRadius(recipe, direction);
      total += ((radius * radius * radius) / 3) * Math.sin(theta) * thetaStep * phiStep;
    }
  }

  return total;
}

describe("computeSolidMetrics", () => {
  it("returns exact metrics for a unit cube", () => {
    const { volume, centroid } = computeSolidMetrics(new THREE.BoxGeometry(1, 1, 1));

    expect(volume).toBeCloseTo(1, 10);
    expect(centroid.x).toBeCloseTo(0, 10);
    expect(centroid.y).toBeCloseTo(0, 10);
    expect(centroid.z).toBeCloseTo(0, 10);
  });

  it("returns exact metrics for a hand-built tetrahedron", () => {
    const indexed = computeSolidMetrics(buildIndexedTetrahedron());
    const nonIndexed = computeSolidMetrics(buildNonIndexedTetrahedron());

    for (const metrics of [indexed, nonIndexed]) {
      expect(metrics.volume).toBeCloseTo(1 / 6, 10);
      expect(metrics.centroid.x).toBeCloseTo(0.25, 10);
      expect(metrics.centroid.y).toBeCloseTo(0.25, 10);
      expect(metrics.centroid.z).toBeCloseTo(0.25, 10);
    }

    expect(indexed.volume).toBe(nonIndexed.volume);
  });

  it("keeps volume invariant under translation and moves the centroid with it", () => {
    const offset = new THREE.Vector3(3, -2, 1);
    const translatedGeometry = new THREE.BoxGeometry(1, 1, 1).translate(offset.x, offset.y, offset.z);
    const translated = computeSolidMetrics(translatedGeometry);

    expect(translated.volume).toBeCloseTo(1, 10);
    expect(translated.centroid.x).toBeCloseTo(offset.x, 10);
    expect(translated.centroid.y).toBeCloseTo(offset.y, 10);
    expect(translated.centroid.z).toBeCloseTo(offset.z, 10);
  });

  it("matches the exact volume of a faceted cylinder prism", () => {
    const segments = 64;
    const radius = 1;
    const height = 2;
    const expected = (segments / 2) * radius * radius * Math.sin((Math.PI * 2) / segments) * height;
    const { volume } = computeSolidMetrics(new THREE.CylinderGeometry(radius, radius, height, segments));

    expect(volume / expected).toBeCloseTo(1, 5);
  });

  it("computes faceted cone volume and centroid height exactly", () => {
    const segments = 128;
    const height = 2;
    const baseArea = (segments / 2) * Math.sin((Math.PI * 2) / segments);
    const expectedVolume = (baseArea * height) / 3;
    const { volume, centroid } = computeSolidMetrics(new THREE.ConeGeometry(1, height, segments));

    expect(volume / expectedVolume).toBeCloseTo(1, 4);
    expect(centroid.y).toBeCloseTo(-height / 4, 3);
    expect(Math.abs(centroid.x)).toBeLessThan(1e-5);
    expect(Math.abs(centroid.z)).toBeLessThan(1e-5);
  });

  it("converges to the analytic sphere volume as tessellation increases", () => {
    const analytic = (Math.PI * 4) / 3;
    const coarse = computeSolidMetrics(new THREE.SphereGeometry(1, 16, 12)).volume;
    const fine = computeSolidMetrics(new THREE.SphereGeometry(1, 144, 96)).volume;

    expect(coarse).toBeLessThan(analytic);
    expect(fine).toBeLessThan(analytic);
    expect(fine / analytic).toBeGreaterThan(0.999);
    expect(Math.abs(fine - analytic)).toBeLessThan(Math.abs(coarse - analytic));
  });
});

describe("solid metrics on irregular shapes", () => {
  it("matches direct quadrature of the continuous shape field", () => {
    const field = buildIrregularGeometry(quadratureRecipe);

    try {
      const { volume } = computeSolidMetrics(field.geometry);
      const reference = quadratureVolume(quadratureRecipe, 300, 600);

      expect(volume / reference).toBeGreaterThan(0.995);
      expect(volume / reference).toBeLessThan(1.005);
    } finally {
      field.geometry.dispose();
    }
  });

  it("produces positive finite volumes and bounded centroids for every preset", () => {
    for (const recipe of [quadratureRecipe, ...shapePresets]) {
      const field = buildIrregularGeometry(recipe);

      try {
        const { volume, centroid } = computeSolidMetrics(field.geometry);

        expect(volume).toBeGreaterThan(0);
        expect(Number.isFinite(centroid.x)).toBe(true);
        expect(Number.isFinite(centroid.y)).toBe(true);
        expect(Number.isFinite(centroid.z)).toBe(true);
        expect(centroid.length()).toBeLessThan(2);
      } finally {
        field.geometry.dispose();
      }
    }
  });
});

describe("input validation", () => {
  it("rejects geometries without a position attribute", () => {
    expect(() => computeSolidMetrics(new THREE.BufferGeometry())).toThrow(/position attribute/);
  });

  it("rejects open surfaces", () => {
    const openTriangle = new THREE.BufferGeometry();
    openTriangle.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));

    expect(() => computeSolidMetrics(openTriangle)).toThrow(/closed mesh/);
  });
});
