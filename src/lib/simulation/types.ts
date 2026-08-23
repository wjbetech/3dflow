import type * as THREE from "three";

export type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  predicted: THREE.Vector3;
};

export type SimulationConfig = {
  particleRadius: number;
  restDensity: number;
  solverIterations: number;
  gravity: THREE.Vector3;
  timeStep: number;
  mouthY?: number | null;
};

export type SimulationState = {
  particles: Particle[];
  time: number;
  stepCount: number;
};

export type BoundarySample = {
  distance: number;
  gradient: THREE.Vector3;
};

export interface Solver {
  readonly config: Readonly<SimulationConfig>;
  step(state: SimulationState, dt: number, boundary: BoundarySampler): void;
  reset(state: SimulationState): void;
}

export interface BoundarySampler {
  sampleDistance(point: THREE.Vector3): number;
  sampleGradient(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  isInside(point: THREE.Vector3): boolean;
}
