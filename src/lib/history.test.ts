import { describe, expect, it } from "vitest";
import { pushChange, redo, undo, type HistoryState } from "./history";

function makeHistory(values: number[]): HistoryState<number> {
  return {
    past: values.slice(0, -1),
    present: values[values.length - 1] ?? 0,
    future: []
  };
}

describe("pushChange", () => {
  it("pushes the previous present into past and clears the future", () => {
    const state = makeHistory([1, 2]);
    const { state: next } = pushChange(state, 3, undefined, 1000, null);

    expect(next.past).toEqual([1, 2]);
    expect(next.present).toBe(3);
    expect(next.future).toEqual([]);
  });

  it("coalesces same-tag changes inside the window without growing past", () => {
    const first = pushChange(makeHistory([1]), 2, "slider", 1000, null);
    const second = pushChange(first.state, 3, "slider", 1400, first.last);

    expect(second.state.past).toEqual([1]);
    expect(second.state.present).toBe(3);
    expect(second.last).toEqual({ tag: "slider", time: 1400 });
  });

  it("stops coalescing after the window expires", () => {
    const first = pushChange(makeHistory([1]), 2, "slider", 1000, null);
    const second = pushChange(first.state, 3, "slider", 1000 + 799, first.last);
    const third = pushChange(second.state, 4, "slider", 1000 + 799 + 801, second.last);

    expect(third.state.past).toEqual([1, 3]);
    expect(third.state.present).toBe(4);
  });

  it("never coalesces untagged changes", () => {
    const first = pushChange(makeHistory([1]), 2, undefined, 1000, null);
    const second = pushChange(first.state, 3, undefined, 1050, first.last);

    expect(second.state.past).toEqual([1, 2]);
    expect(second.state.present).toBe(3);
  });

  it("caps the past length at fifty entries", () => {
    let state = makeHistory([0]);

    for (let i = 1; i <= 60; i += 1) {
      state = pushChange(state, i, `tag-${i}`, i * 10_000, null).state;
    }

    expect(state.past.length).toBe(50);
    expect(state.present).toBe(60);
  });
});

describe("undo and redo", () => {
  it("walks back and forward through entries", () => {
    let state = makeHistory([1]);

    for (const value of [2, 3, 4]) {
      state = pushChange(state, value, undefined, 0, null).state;
    }

    state = undo(state);
    expect(state.present).toBe(3);
    state = undo(state);
    expect(state.present).toBe(2);
    state = redo(state);
    expect(state.present).toBe(3);
    state = redo(state);
    expect(state.present).toBe(4);
    expect(state.future).toEqual([]);

    const exhaustedRedo = redo(state);

    expect(exhaustedRedo).toBe(state);

    state = undo(state);
    const branched = pushChange(state, 99, undefined, 0, null).state;

    expect(branched.future).toEqual([]);
    expect(branched.past[branched.past.length - 1]).toBe(3);
  });

  it("reports empty stacks as no-ops", () => {
    const state = makeHistory([5]);

    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });
});
