import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildIrregularGeometry, shapePresets } from "../shapes";
import { buildVoxelSdf, type VoxelSdf } from "./sdf";

function sampleSpherePoint(radius: number, theta: number, phi: number) {
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

describe("buildVoxelSdf", () => {
  it("classifies a unit cube's interior and exterior with margin control", () => {
    const sdf = buildVoxelSdf(new THREE.BoxGeometry(1, 1, 1), 48);

    expect(sdf.isInside(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(sdf.isInside(new THREE.Vector3(0.35, 0.1, -0.2))).toBe(true);
    expect(sdf.isInside(new THREE.Vector3(5, 5, 5))).toBe(false);
    expect(sdf.isInside(new THREE.Vector3(-4, 0, 0))).toBe(false);

    const nearFace = new THREE.Vector3(0.47, 0, 0);

    expect(sdf.isInside(nearFace)).toBe(true);
    expect(sdf.isInside(nearFace, 0.05)).toBe(false);

    const deepInterior = new THREE.Vector3(0.1, 0, 0);

    expect(sdf.isInside(deepInterior, 0.05)).toBe(true);
  });

  it("keeps radial monotonicity across a sphere shell", () => {
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const sdf = buildVoxelSdf(geometry, 64);

    let previous = Number.NEGATIVE_INFINITY;

    for (let step = 0; step <= 20; step += 1) {
      const radius = 0.7 + (0.6 * step) / 20;
      const distance = sdf.sampleDistance(sampleSpherePoint(radius, 0.4, 0.9));

      if (step > 0) {
        expect(distance).toBeGreaterThanOrEqual(previous - 1e-9);
      }

      previous = distance;
    }

    expect(previous).toBeGreaterThan(0);
    expect(sdf.sampleDistance(new THREE.Vector3(0, 0, 0))).toBeLessThan(
      -sdf.cellSize * 3
    );
  });

  it("agrees with the analytic field away from walls on irregular vessels", () => {
    const field = buildIrregularGeometry(shapePresets[0]);

    try {
      const voxelSdf = field.sdf as VoxelSdf;
      const bounds = field.bounds;
      let agreements = 0;
      let comparisons = 0;

      for (let attempt = 0; attempt < 400; attempt += 1) {
        const point = new THREE.Vector3(
          bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x),
          bounds.min.y + Math.random() * (bounds.max.y - bounds.min.y) * 0.8 + bounds.min.y * 0,
          bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z)
        );

        point.y = THREE.MathUtils.lerp(bounds.min.y, (field.mouthY ?? bounds.max.y) - 0.15, Math.random());

        const distanceToWall = Math.min(
          Math.abs(point.x) + Math.abs(point.y) + Math.abs(point.z)
        );
        void distanceToWall;

        const sdfVerdict = voxelSdf.isInside(point);
        const meshReference = referenceInside(field, point);

        if (!meshReference.ambiguous) {
          comparisons += 1;

          if (sdfVerdict === meshReference.inside) {
            agreements += 1;
          }
        }
      }

      expect(comparisons).toBeGreaterThan(100);
      expect(agreements / comparisons).toBeGreaterThan(0.97);
    } finally {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    }
  });

  it("never reports inside above the mouth plane", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const cappedSource = clipBoxBelowHalf(geometry);
    const sdf = buildVoxelSdf(cappedSource, 48);

    expect(sdf.isInside(new THREE.Vector3(0, 0.45, 0))).toBe(true);
    expect(sdf.isInside(new THREE.Vector3(0, 0.55, 0))).toBe(false);
    expect(sdf.isInside(new THREE.Vector3(0, 0.75, 0))).toBe(false);
  });
});

function referenceInside(field: ReturnType<typeof buildIrregularGeometry>, point: THREE.Vector3) {  const uncentered = point.clone().add(field.centerOffset);
  const scaled = new THREE.Vector3(
    uncentered.x / field.scale.x,
    uncentered.y / field.scale.y,
    uncentered.z / field.scale.z
  );
  const distance = scaled.length();
  const direction = distance <= 1e-9 ? new THREE.Vector3(0, 1, 0) : scaled.clone().divideScalar(distance);

  const radius = directionalRadius(field.recipe, direction);
  const signedDistance = radius - distance;

  return {
    inside: signedDistance > 0.08,
    ambiguous: Math.abs(signedDistance) < 0.12
  };
}

function directionalRadius(recipe: ReturnType<typeof buildIrregularGeometry>["recipe"], direction: THREE.Vector3) {
  const waveA = Math.sin(direction.x * recipe.ridges + recipe.seed);
  const waveB = Math.cos(direction.y * (recipe.ridges + 1) - recipe.seed * 1.3);
  const waveC = Math.sin(direction.z * (recipe.ridges + 2) + recipe.seed * 0.6);
  const compound = (waveA + waveB + waveC) / 3;
  const wobble = recipe.twist * direction.x * direction.y * direction.z * 8;

  return Math.max(0.65, 1.22 * (1 + compound * recipe.amplitude + wobble));
}

function clipBoxBelowHalf(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const out: number[] = [];

  for (let start = 0; start < positions.count; start += 3) {
    const tri: Array<[number, number, number]> = [];

    for (let corner = 0; corner < 3; corner += 1) {
      tri.push([positions.getX(start + corner), positions.getY(start + corner), positions.getZ(start + corner)]);
    }

    const kept: Array<[number, number, number]> = [];
    const limit = 0.5;

    for (let i = 0; i < 3; i += 1) {
      const current = tri[i];
      const next = tri[(i + 1) % 3];
      const currentBelow = current[1] <= limit;
      const nextBelow = next[1] <= limit;

      if (currentBelow) {
        kept.push(current);
      }

      if (currentBelow !== nextBelow) {
        let low = current;
        let high = next;

        if (low[1] > high[1]) {
          const swap = low;
          low = high;
          high = swap;
        }

        const t = (limit - low[1]) / (high[1] - low[1]);
        kept.push([
          low[0] + (high[0] - low[0]) * t,
          limit,
          low[2] + (high[2] - low[2]) * t
        ]);
      }
    }

    for (let i = 1; i < kept.length - 1; i += 1) {
      for (const vertex of [kept[0], kept[i], kept[i + 1]]) {
        out.push(vertex[0], vertex[1], vertex[2]);
      }
    }
  }

  const clipped = new THREE.BufferGeometry();
  clipped.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return clipped;
}
