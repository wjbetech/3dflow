import * as THREE from "three";
import type { BoundarySampler } from "./types";
import type { SimulationState } from "./types";

export function seedParticlesInBoundary(
  count: number,
  boundary: BoundarySampler,
  bounds: THREE.Box3,
  radius = 0.04
): SimulationState {
  const particles: SimulationState["particles"] = [];
  const candidate = new THREE.Vector3();
  let attempts = 0;
  const maxAttempts = count * 80;
  while (particles.length < count && attempts < maxAttempts) {
    attempts += 1;
    candidate.set(
      THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, Math.random()),
      THREE.MathUtils.lerp(bounds.min.y, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.6, Math.random()),
      THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, Math.random())
    );
    if (boundary.sampleDistance(candidate) < -radius) {
      particles.push({
        position: candidate.clone(),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2),
        predicted: candidate.clone()
      });
    }
  }
  return { particles, time: 0, stepCount: 0 };
}
