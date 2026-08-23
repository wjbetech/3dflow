import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildVoxelSdf } from "../metrics/sdf";
import { createSdfBoundary } from "./boundary";

describe("createSdfBoundary", () => {
  it("classifies inside versus outside consistently with the voxel field", () => {
    const sdf = buildVoxelSdf(new THREE.BoxGeometry(1, 1, 1), 32);
    const boundary = createSdfBoundary(sdf);

    expect(boundary.isInside(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(boundary.isInside(new THREE.Vector3(0.8, 0, 0))).toBe(false);
    expect(boundary.sampleDistance(new THREE.Vector3(0, 0, 0))).toBeLessThan(0);
    expect(boundary.sampleDistance(new THREE.Vector3(0.8, 0, 0))).toBeGreaterThanOrEqual(0);
  });

  it("returns a normalized gradient near the surface", () => {
    const sdf = buildVoxelSdf(new THREE.SphereGeometry(1, 32, 16), 40);
    const boundary = createSdfBoundary(sdf);
    const out = new THREE.Vector3();

    boundary.sampleGradient(new THREE.Vector3(0.95, 0, 0), out);

    expect(out.length()).toBeCloseTo(1, 1);
    expect(out.x).toBeGreaterThan(0.5);
  });

  it("stays stable deep inside", () => {
    const sdf = buildVoxelSdf(new THREE.BoxGeometry(2, 2, 2), 32);
    const boundary = createSdfBoundary(sdf);
    const out = new THREE.Vector3();

    boundary.sampleGradient(new THREE.Vector3(0, 0, 0), out);

    expect(Number.isFinite(out.x)).toBe(true);
  });
});
