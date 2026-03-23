import * as THREE from "three";
import { isPointInsideField, type ShapeField } from "./shapes";

export type FluidState = {
  size: number;
  density: Float32Array;
  targetDensity: Float32Array;
  scratch: Float32Array;
  solid: Uint8Array;
  cellCenters: Float32Array;
  solidIndices: number[];
  targetMass: number;
};

export function createFluidState(field: ShapeField, fillPercent: number, size = 20) {
  const total = size * size * size;
  const density = new Float32Array(total);
  const targetDensity = new Float32Array(total);
  const scratch = new Float32Array(total);
  const solid = new Uint8Array(total);
  const cellCenters = new Float32Array(total * 3);
  const solidIndices: number[] = [];
  const point = new THREE.Vector3();

  forEachCell(size, (x, y, z, index) => {
    getCellPosition(field, size, x, y, z, point);
    cellCenters[index * 3] = point.x;
    cellCenters[index * 3 + 1] = point.y;
    cellCenters[index * 3 + 2] = point.z;

    if (isPointInsideField(field, point, 0.08)) {
      solid[index] = 1;
      solidIndices.push(index);
    }
  });

  const targetMass = Math.round(THREE.MathUtils.clamp(fillPercent / 100, 0, 1) * solidIndices.length);
  const state: FluidState = {
    size,
    density,
    targetDensity,
    scratch,
    solid,
    cellCenters,
    solidIndices,
    targetMass
  };

  updateTargetDensity(state, new THREE.Vector3(0, 1, 0));
  state.density.set(state.targetDensity);
  return state;
}

export function setFluidFillPercent(state: FluidState, fillPercent: number) {
  state.targetMass = Math.round(THREE.MathUtils.clamp(fillPercent / 100, 0, 1) * state.solidIndices.length);
}

export function stepFluidState(
  state: FluidState,
  gravity: THREE.Vector3,
  motionAmount: number
) {
  const up = gravity.lengthSq() > 1e-6 ? gravity.clone().normalize().negate() : new THREE.Vector3(0, 1, 0);

  updateTargetDensity(state, up);

  const alpha = THREE.MathUtils.clamp(0.08 + motionAmount * 0.22, 0.08, 0.32);

  for (let index = 0; index < state.density.length; index += 1) {
    if (state.solid[index] === 0) {
      state.density[index] = 0;
      continue;
    }

    state.density[index] = THREE.MathUtils.lerp(state.density[index], state.targetDensity[index], alpha);
  }

  smoothDensity(state, 2, 0.34);
  renormalizeMass(state);
}

function updateTargetDensity(state: FluidState, up: THREE.Vector3) {
  state.targetDensity.fill(0);

  const ranked = state.solidIndices
    .map((index) => ({
      index,
      potential:
        state.cellCenters[index * 3] * up.x +
        state.cellCenters[index * 3 + 1] * up.y +
        state.cellCenters[index * 3 + 2] * up.z
    }))
    .sort((a, b) => a.potential - b.potential);

  for (let i = 0; i < state.targetMass && i < ranked.length; i += 1) {
    state.targetDensity[ranked[i].index] = 1;
  }
}

function smoothDensity(state: FluidState, passes: number, blend: number) {
  const size = state.size;

  for (let pass = 0; pass < passes; pass += 1) {
    forEachCell(size, (x, y, z, index) => {
      if (state.solid[index] === 0) {
        state.scratch[index] = 0;
        return;
      }

      let total = state.density[index];
      let count = 1;

      total += sampleSolidDensity(state, x + 1, y, z, countRef => (count += countRef));
      total += sampleSolidDensity(state, x - 1, y, z, countRef => (count += countRef));
      total += sampleSolidDensity(state, x, y + 1, z, countRef => (count += countRef));
      total += sampleSolidDensity(state, x, y - 1, z, countRef => (count += countRef));
      total += sampleSolidDensity(state, x, y, z + 1, countRef => (count += countRef));
      total += sampleSolidDensity(state, x, y, z - 1, countRef => (count += countRef));

      const average = total / count;
      state.scratch[index] = THREE.MathUtils.lerp(state.density[index], average, blend);
    });

    state.density.set(state.scratch);
  }
}

function renormalizeMass(state: FluidState) {
  let total = 0;

  for (let index = 0; index < state.density.length; index += 1) {
    if (state.solid[index] !== 0) {
      state.density[index] = THREE.MathUtils.clamp(state.density[index], 0, 1);
      total += state.density[index];
    } else {
      state.density[index] = 0;
    }
  }

  if (total <= 1e-5 || state.targetMass <= 0) {
    return;
  }

  const scale = state.targetMass / total;

  for (let index = 0; index < state.density.length; index += 1) {
    if (state.solid[index] !== 0) {
      state.density[index] = THREE.MathUtils.clamp(state.density[index] * scale, 0, 1);
    }
  }
}

function sampleSolidDensity(
  state: FluidState,
  x: number,
  y: number,
  z: number,
  onCount: (count: number) => void
) {
  if (!isInsideGrid(state.size, x, y, z)) {
    onCount(0);
    return 0;
  }

  const index = ix(state.size, x, y, z);

  if (state.solid[index] === 0) {
    onCount(0);
    return 0;
  }

  onCount(1);
  return state.density[index];
}

function getCellPosition(field: ShapeField, size: number, x: number, y: number, z: number, target: THREE.Vector3) {
  const px = size <= 1 ? 0 : x / (size - 1);
  const py = size <= 1 ? 0 : y / (size - 1);
  const pz = size <= 1 ? 0 : z / (size - 1);

  return target.set(
    THREE.MathUtils.lerp(field.bounds.min.x, field.bounds.max.x, px),
    THREE.MathUtils.lerp(field.bounds.min.y, field.bounds.max.y, py),
    THREE.MathUtils.lerp(field.bounds.min.z, field.bounds.max.z, pz)
  );
}

function forEachCell(
  size: number,
  callback: (x: number, y: number, z: number, index: number) => void
) {
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        callback(x, y, z, ix(size, x, y, z));
      }
    }
  }
}

function ix(size: number, x: number, y: number, z: number) {
  return x + y * size + z * size * size;
}

function isInsideGrid(size: number, x: number, y: number, z: number) {
  return x >= 0 && x < size && y >= 0 && y < size && z >= 0 && z < size;
}
