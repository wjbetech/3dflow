import { describe, expect, it } from "vitest";
import { poly6, spikyGrad, buildSpatialHash, forEachNeighbor } from "./pbfKernels";
import * as THREE from "three";

describe("poly6", () => {
  it("is zero outside support", () => {
    expect(poly6(1, 0.5)).toBe(0);
    expect(poly6(0.6, 0.5)).toBe(0);
  });
  it("positive inside", () => {
    expect(poly6(0, 0.1)).toBeGreaterThan(0);
  });
});

describe("spikyGrad", () => {
  it("zero outside", () => {
    const out = new THREE.Vector3(1, 2, 3);
    spikyGrad(new THREE.Vector3(1, 0, 0), 1, 0.5, out);
    expect(out.length()).toBe(0);
  });
});

describe("spatial hash", () => {
  it("finds neighbors", () => {
    const positions = new Float32Array([0, 0, 0, 0.05, 0, 0, 5, 5, 5]);
    const map = new Map<string, number[]>();
    buildSpatialHash(positions, 3, 0.2, map);
    let count = 0;
    forEachNeighbor(0, positions, 0.2, map, () => { count += 1; });
    expect(count).toBeGreaterThan(1);
    expect(map.size).toBeGreaterThan(0);
  });
});
