import * as THREE from "three";
import type { BoundarySampler, SimulationConfig, SimulationState, Solver } from "./types";

export class NullSolver implements Solver {
  constructor(public readonly config: SimulationConfig) {}

  step(state: SimulationState, dt: number, boundary: BoundarySampler): void {
    for (const p of state.particles) {
      p.predicted.copy(p.position);

      const next = p.position.clone().addScaledVector(p.velocity, dt).addScaledVector(this.config.gravity, 0.5 * dt * dt);

      if (!boundary.isInside(next)) {
        const gradient = boundary.sampleGradient(next, new THREE.Vector3());

        next.addScaledVector(gradient, -boundary.sampleDistance(next) - this.config.particleRadius * 0.5);
        p.velocity.reflect(gradient).multiplyScalar(0.2);
      }

      p.predicted.copy(next);
      p.position.copy(next);
      p.velocity.addScaledVector(this.config.gravity, dt).multiplyScalar(0.995);
    }

    void dt;
  }

  reset(_state: SimulationState): void {
    void _state;
  }
}

export function createNullSolver(overrides: Partial<SimulationConfig> = {}): NullSolver {
  return new NullSolver({
    particleRadius: 0.04,
    restDensity: 1000,
    solverIterations: 3,
    gravity: new THREE.Vector3(0, -9.81, 0),
    timeStep: 1 / 60,
    ...overrides
  });
}
