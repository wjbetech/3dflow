import * as THREE from "three";
import { advanceAccumulator, createAccumulator, type FixedStepAccumulator } from "./accumulator";
import type { BoundarySampler, SimulationState, Solver } from "./types";

export type SimulationControllerConfig = {
  fixedDt: number;
  maxSubSteps: number;
};

export class SimulationController {
  private accumulator: FixedStepAccumulator = createAccumulator();
  private state: SimulationState;
  private boundary: BoundarySampler;

  constructor(
    private solver: Solver,
    initialState: SimulationState,
    boundary: BoundarySampler,
    private config: SimulationControllerConfig = { fixedDt: 1 / 60, maxSubSteps: 8 }
  ) {
    this.state = initialState;
    this.boundary = boundary;
  }

  getState(): SimulationState {
    return this.state;
  }

  getBoundary(): BoundarySampler {
    return this.boundary;
  }

  setBoundary(boundary: BoundarySampler): void {
    this.boundary = boundary;
  }

  reset(state: SimulationState): void {
    this.state = state;
    this.accumulator.accumulator = 0;
    this.solver.reset(state);
  }

  update(deltaSeconds: number, upToDateBoundary?: BoundarySampler): number {
    if (upToDateBoundary) {
      this.boundary = upToDateBoundary;
    }

    const steps = advanceAccumulator(this.accumulator, deltaSeconds, this.config.fixedDt, this.config.maxSubSteps);

    for (let i = 0; i < steps; i += 1) {
      this.solver.step(this.state, this.config.fixedDt, this.boundary);
      this.state.time += this.config.fixedDt;
      this.state.stepCount += 1;
    }

    return steps;
  }

  getAlpha(): number {
    return this.accumulator.alpha;
  }

  interpolatePositions(out: Float32Array, alpha = this.getAlpha()): void {
    const particles = this.state.particles;

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const base = i * 3;

      out[base] = THREE.MathUtils.lerp(p.position.x, p.predicted.x, alpha);
      out[base + 1] = THREE.MathUtils.lerp(p.position.y, p.predicted.y, alpha);
      out[base + 2] = THREE.MathUtils.lerp(p.position.z, p.predicted.z, alpha);
    }
  }
}
