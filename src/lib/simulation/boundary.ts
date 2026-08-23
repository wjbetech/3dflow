import * as THREE from "three";
import type { BoundarySampler } from "./types";
import type { VoxelSdf } from "../metrics/sdf";

const scratch = new THREE.Vector3();

export function createSdfBoundary(sdf: VoxelSdf): BoundarySampler {
  return {
    sampleDistance(point: THREE.Vector3) {
      return sdf.sampleDistance(point);
    },
    sampleGradient(point: THREE.Vector3, out: THREE.Vector3) {
      const h = sdf.cellSize * 0.5;

      scratch.set(point.x + h, point.y, point.z);
      const dxPos = sdf.sampleDistance(scratch);
      scratch.set(point.x - h, point.y, point.z);
      const dxNeg = sdf.sampleDistance(scratch);

      scratch.set(point.x, point.y + h, point.z);
      const dyPos = sdf.sampleDistance(scratch);
      scratch.set(point.x, point.y - h, point.z);
      const dyNeg = sdf.sampleDistance(scratch);

      scratch.set(point.x, point.y, point.z + h);
      const dzPos = sdf.sampleDistance(scratch);
      scratch.set(point.x, point.y, point.z - h);
      const dzNeg = sdf.sampleDistance(scratch);

      out.set(dxPos - dxNeg, dyPos - dyNeg, dzPos - dzNeg).normalize();

      if (!Number.isFinite(out.x)) {
        out.set(0, 1, 0);
      }

      return out;
    },
    isInside(point: THREE.Vector3) {
      return sdf.sampleDistance(point) < 0;
    }
  };
}
