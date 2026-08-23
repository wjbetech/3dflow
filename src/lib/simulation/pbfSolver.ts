import * as THREE from "three";
import type { BoundarySampler, SimulationConfig, SimulationState, Solver } from "./types";
import { forEachNeighbor, buildSpatialHash, poly6, spikyGrad } from "./pbfKernels";

const scratchVec = new THREE.Vector3();
const gradScratch = new THREE.Vector3();

export class PbfSolver implements Solver {
  private hash = new Map<string, number[]>();
  private predicted = new Float32Array(0);
  private lambdas = new Float32Array(0);
  private deltaP = new Float32Array(0);

  constructor(public readonly config: SimulationConfig) {}

  step(state: SimulationState, dt: number, boundary: BoundarySampler): void {
    const n = state.particles.length;
    if (n === 0) return;
    this.ensureBuffers(n);

    for (let i = 0; i < n; i += 1) {
      const p = state.particles[i];
      p.velocity.addScaledVector(this.config.gravity, dt);
      const base = i * 3;
      this.predicted[base] = p.position.x + p.velocity.x * dt;
      this.predicted[base + 1] = p.position.y + p.velocity.y * dt;
      this.predicted[base + 2] = p.position.z + p.velocity.z * dt;
      p.predicted.set(this.predicted[base], this.predicted[base + 1], this.predicted[base + 2]);
    }

    const h = this.config.particleRadius * 4;
    const restDensity = this.config.restDensity;

    buildSpatialHash(this.predicted, n, h, this.hash);

    for (let iter = 0; iter < this.config.solverIterations; iter += 1) {
      for (let i = 0; i < n; i += 1) {
        let density = 0;
        let gradSumSq = 0;
        const gradI = new THREE.Vector3();
        forEachNeighbor(i, this.predicted, h, this.hash, (j) => {
          const dx = this.predicted[i * 3] - this.predicted[j * 3];
          const dy = this.predicted[i * 3 + 1] - this.predicted[j * 3 + 1];
          const dz = this.predicted[i * 3 + 2] - this.predicted[j * 3 + 2];
          const r = Math.hypot(dx, dy, dz);
          density += poly6(r, h);
          if (j !== i) {
            scratchVec.set(dx, dy, dz);
            spikyGrad(scratchVec, r, h, gradScratch);
            gradI.add(gradScratch);
            gradSumSq += gradScratch.lengthSq();
          }
        });
        gradSumSq += gradI.lengthSq();
        const C = density / restDensity - 1;
        this.lambdas[i] = -C / (gradSumSq + 1e-6);
      }

      this.deltaP.fill(0);
      for (let i = 0; i < n; i += 1) {
        const delta = new THREE.Vector3();
        forEachNeighbor(i, this.predicted, h, this.hash, (j) => {
          if (i === j) return;
          const dx = this.predicted[i * 3] - this.predicted[j * 3];
          const dy = this.predicted[i * 3 + 1] - this.predicted[j * 3 + 1];
          const dz = this.predicted[i * 3 + 2] - this.predicted[j * 3 + 2];
          const r = Math.hypot(dx, dy, dz);
          scratchVec.set(dx, dy, dz);
          spikyGrad(scratchVec, r, h, gradScratch);
          const corr = (this.lambdas[i] + this.lambdas[j]) * gradScratch.length() * 0.0001;
          delta.addScaledVector(gradScratch, (this.lambdas[i] + this.lambdas[j]));
          void corr;
        });
        const base = i * 3;
        this.deltaP[base] = delta.x;
        this.deltaP[base + 1] = delta.y;
        this.deltaP[base + 2] = delta.z;
      }

      for (let i = 0; i < n; i += 1) {
        const base = i * 3;
        this.predicted[base] += this.deltaP[base];
        this.predicted[base + 1] += this.deltaP[base + 1];
        this.predicted[base + 2] += this.deltaP[base + 2];
      }

      for (let i = 0; i < n; i += 1) {
        const base = i * 3;
        const mouthY = this.config.mouthY;
        const px = this.predicted[base + 1];
        if (mouthY != null && px > mouthY) continue;
        scratchVec.set(this.predicted[base], this.predicted[base + 1], this.predicted[base + 2]);
        const d = boundary.sampleDistance(scratchVec);
        if (d < -this.config.particleRadius * 0.5) continue;
        if (d < this.config.particleRadius) {
          const g = boundary.sampleGradient(scratchVec, gradScratch);
          const push = this.config.particleRadius - d;
          this.predicted[base] += g.x * push;
          this.predicted[base + 1] += g.y * push;
          this.predicted[base + 2] += g.z * push;
        }
      }
      buildSpatialHash(this.predicted, n, h, this.hash);
    }

    for (let i = 0; i < n; i += 1) {
      const p = state.particles[i];
      const base = i * 3;
      const nx = this.predicted[base];
      const ny = this.predicted[base + 1];
      const nz = this.predicted[base + 2];
      p.velocity.set((nx - p.position.x) / dt, (ny - p.position.y) / dt, (nz - p.position.z) / dt);
      const viscosity = this.config.viscosity ?? 0.01;
      if (viscosity > 0) {
        const visc = new THREE.Vector3();
        forEachNeighbor(i, this.predicted, h, this.hash, (j) => {
          if (i === j) return;
          const dx = this.predicted[i * 3] - this.predicted[j * 3];
          const dy = this.predicted[i * 3 + 1] - this.predicted[j * 3 + 1];
          const dz = this.predicted[i * 3 + 2] - this.predicted[j * 3 + 2];
          const r = Math.hypot(dx, dy, dz);
          const w = poly6(r, h);
          visc.addScaledVector(
            new THREE.Vector3(
              state.particles[j].velocity.x - p.velocity.x,
              state.particles[j].velocity.y - p.velocity.y,
              state.particles[j].velocity.z - p.velocity.z
            ),
            w * viscosity
          );
        });
        p.velocity.add(visc);
      }
      const surfaceTension = this.config.surfaceTension ?? 0.02;
      if (surfaceTension > 0) {
        const n = new THREE.Vector3();
        forEachNeighbor(i, this.predicted, h, this.hash, (j) => {
          if (i === j) return;
          const dx = this.predicted[i * 3] - this.predicted[j * 3];
          const dy = this.predicted[i * 3 + 1] - this.predicted[j * 3 + 1];
          const dz = this.predicted[i * 3 + 2] - this.predicted[j * 3 + 2];
          const r = Math.hypot(dx, dy, dz);
          scratchVec.set(dx, dy, dz);
          spikyGrad(scratchVec, r, h, gradScratch);
          n.add(gradScratch);
        });
        p.velocity.addScaledVector(n, -surfaceTension * 0.001);
      }
      p.velocity.multiplyScalar(0.995);
      p.position.set(nx, ny, nz);
      p.predicted.copy(p.position);
    }
  }

  reset(_state: SimulationState): void {
    void _state;
  }

  private ensureBuffers(n: number): void {
    if (this.predicted.length < n * 3) {
      this.predicted = new Float32Array(n * 3);
      this.lambdas = new Float32Array(n);
      this.deltaP = new Float32Array(n * 3);
    }
  }
}

export function createPbfSolver(overrides: Partial<SimulationConfig> = {}): PbfSolver {
  return new PbfSolver({
    particleRadius: 0.035,
    restDensity: 1600,
    solverIterations: 4,
    gravity: new THREE.Vector3(0, -9.81, 0),
    timeStep: 1 / 60,
    mouthY: null,
    viscosity: 0.01,
    surfaceTension: 0.02,
    ...overrides
  });
}
