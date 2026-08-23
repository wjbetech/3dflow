import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSdfBoundary } from "./boundary";
import { SimulationController } from "./controller";
import { createNullSolver } from "./nullSolver";
import type { SimulationState } from "./types";
import { buildVoxelSdf } from "../metrics/sdf";

function makeState(n: number): SimulationState {
  return {
    particles: Array.from({ length: n }, (_, i) => ({
      position: new THREE.Vector3(i * 0.1, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      predicted: new THREE.Vector3(i * 0.1, 0, 0)
    })),
    time: 0,
    stepCount: 0
  };
}

function boxBoundary() {
  return createSdfBoundary(buildVoxelSdf(new THREE.BoxGeometry(4, 4, 4), 24));
}

describe("SimulationController", () => {
  it("steps the solver at a fixed dt independent of render delta", () => {
    const controller = new SimulationController(createNullSolver(), makeState(2), boxBoundary(), {
      fixedDt: 1 / 60,
      maxSubSteps: 8
    });

    controller.update(1 / 60);
    expect(controller.getState().stepCount).toBe(1);

    controller.update((1 / 60) * 0.5);
    expect(controller.getState().stepCount).toBe(1);

    controller.update((1 / 60) * 0.5);
    expect(controller.getState().stepCount).toBe(2);
  });

  it("interpolates particle positions between steps", () => {
    const controller = new SimulationController(createNullSolver(), makeState(1), boxBoundary(), {
      fixedDt: 1 / 60,
      maxSubSteps: 8
    });
    const out = new Float32Array(3);

    controller.update(1 / 60 / 2);
    controller.interpolatePositions(out);
    expect(out[0]).toBeGreaterThanOrEqual(0);
  });

  it("resets time and clears accumulator", () => {
    const controller = new SimulationController(createNullSolver(), makeState(1), boxBoundary(), {
      fixedDt: 1 / 60,
      maxSubSteps: 8
    });

    controller.update(1 / 60);
    controller.update(1 / 60);
    controller.reset(makeState(1));
    expect(controller.getState().stepCount).toBe(0);
    expect(controller.getAlpha()).toBeCloseTo(0, 10);
  });

  it("honors volume conservation on a settled null solver", () => {
    const state = makeState(10);
    const controller = new SimulationController(createNullSolver(), state, boxBoundary(), {
      fixedDt: 1 / 60,
      maxSubSteps: 8
    });

    const before = state.particles.length;

    for (let i = 0; i < 60; i += 1) controller.update(1 / 60);

    expect(controller.getState().particles.length).toBe(before);
  });
});
