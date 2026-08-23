import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildWaterBody } from "./waterMesh";

function meshVolume(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  let total = 0;

  for (let start = 0; start < positions.count; start += 3) {
    const ax = positions.getX(start);
    const ay = positions.getY(start);
    const az = positions.getZ(start);
    const bx = positions.getX(start + 1);
    const by = positions.getY(start + 1);
    const bz = positions.getZ(start + 1);
    const cx = positions.getX(start + 2);
    const cy = positions.getY(start + 2);
    const cz = positions.getZ(start + 2);

    total += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }

  return Math.abs(total) / 6;
}

const up = new THREE.Vector3(0, 1, 0);

describe("buildWaterBody", () => {
  it("fills a unit cube to the exact submerged volume", () => {
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const water = buildWaterBody(cube, up, 0.25);

    expect(meshVolume(water)).toBeCloseTo(0.75, 6);

    const positions = water.getAttribute("position");
    let surfaceVertices = 0;

    for (let i = 0; i < positions.count; i += 1) {
      expect(positions.getY(i)).toBeLessThanOrEqual(0.25 + 1e-6);

      if (Math.abs(positions.getY(i) - 0.25) < 1e-5) {
        surfaceVertices += 1;
      }
    }

    expect(surfaceVertices).toBeGreaterThanOrEqual(3);
  });

  it("returns the full mesh when fully submerged and empty when dry", () => {
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const full = buildWaterBody(cube, up, 10);
    const dry = buildWaterBody(cube, up, -10);

    expect(meshVolume(full)).toBeCloseTo(1, 6);
    expect(dry.getAttribute("position").count).toBe(0);
  });

  it("keeps volume invariant under opposite orientations summing to the whole", () => {
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const tilted = new THREE.Vector3(Math.sin(0.4), Math.cos(0.4), 0.2).normalize();
    const water = buildWaterBody(cube, tilted, 0.15);
    const complement = buildWaterBody(cube, tilted.clone().negate(), -0.15);

    const combined = meshVolume(water) + meshVolume(complement);

    expect(combined).toBeCloseTo(1, 5);
    expect(meshVolume(water)).toBeGreaterThan(0);
    expect(meshVolume(complement)).toBeGreaterThan(0);
  });

  it("produces monotone volumes as the level rises", () => {
    const sphere = new THREE.SphereGeometry(1, 48, 24);
    let previous = -1;

    for (const offset of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const volume = meshVolume(buildWaterBody(sphere, up, offset));

      expect(volume).toBeGreaterThan(previous);
      previous = volume;
    }
  });
});
