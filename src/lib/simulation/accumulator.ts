export type FixedStepAccumulator = {
  accumulator: number;
  alpha: number;
};

export function createAccumulator(): FixedStepAccumulator {
  return { accumulator: 0, alpha: 0 };
}

export function advanceAccumulator(
  acc: FixedStepAccumulator,
  deltaSeconds: number,
  fixedDt: number,
  maxSubSteps = 8
): number {
  acc.accumulator += deltaSeconds;
  acc.accumulator = Math.min(acc.accumulator, fixedDt * maxSubSteps);

  let steps = 0;

  while (acc.accumulator >= fixedDt) {
    acc.accumulator -= fixedDt;
    steps += 1;
  }

  acc.alpha = acc.accumulator / fixedDt;

  return steps;
}

export function interpolationAlpha(acc: FixedStepAccumulator): number {
  return acc.alpha;
}
