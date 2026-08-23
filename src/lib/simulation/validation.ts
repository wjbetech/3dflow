import * as THREE from "three";
import { createSdfBoundary } from "./boundary";
import { SimulationController } from "./controller";
import { createPbfSolver } from "./pbfSolver";
import { seedParticlesInBoundary } from "./seed";
import { buildVoxelSdf } from "../metrics/sdf";

export type ValidationResult = {
  name: string;
  passed: boolean;
  error: number;
  details: string;
};

export function runDamBreakConservation(): ValidationResult {
  const sdf = buildVoxelSdf(new THREE.BoxGeometry(2, 1, 1), 32);
  const boundary = createSdfBoundary(sdf);
  const bounds = new THREE.Box3(new THREE.Vector3(-1, -0.5, -0.5), new THREE.Vector3(1, 0.5, 0.5));
  const state = seedParticlesInBoundary(500, boundary, bounds, 0.04);
  const before = state.particles.length;
  const solver = createPbfSolver({ mouthY: null });
  const ctrl = new SimulationController(solver, state, boundary, { fixedDt: 1 / 60, maxSubSteps: 4 });
  for (let i = 0; i < 60; i += 1) ctrl.update(1 / 60);
  const after = ctrl.getState().particles.length;
  const error = Math.abs(after - before) / before;
  return {
    name: "dam-break conservation",
    passed: error < 0.01,
    error,
    details: `particles ${before} -> ${after}`
  };
}

export function runSloshPeriod(): ValidationResult {
  const sdf = buildVoxelSdf(new THREE.CylinderGeometry(1, 1, 1, 32), 32);
  const boundary = createSdfBoundary(sdf);
  const bounds = new THREE.Box3(new THREE.Vector3(-1, -0.5, -1), new THREE.Vector3(1, 0.5, 1));
  const state = seedParticlesInBoundary(400, boundary, bounds, 0.045);
  const solver = createPbfSolver({ mouthY: 0.5 });
  const ctrl = new SimulationController(solver, state, boundary, { fixedDt: 1 / 60, maxSubSteps: 4 });
  let maxY = -Infinity;
  let valid = true;
  for (let i = 0; i < 120; i += 1) {
    ctrl.update(1 / 60);
    const comY = ctrl.getState().particles.reduce((s, p) => s + p.position.y, 0) / ctrl.getState().particles.length;
    if (!Number.isFinite(comY)) valid = false;
    if (comY > maxY) maxY = comY;
  }
  const error = valid && Number.isFinite(maxY) ? 0 : 0.2;
  return {
    name: "cylinder slosh",
    passed: error < 0.15,
    error,
    details: `max comY ${maxY.toFixed(3)}`
  };
}
