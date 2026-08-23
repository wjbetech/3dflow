export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export type CoalesceRef = { tag: string; time: number };

export const HISTORY_LIMIT = 50;
export const COALESCE_WINDOW_MS = 800;

export function pushChange<T>(
  state: HistoryState<T>,
  next: T,
  tag: string | undefined,
  now: number,
  last: CoalesceRef | null
): { state: HistoryState<T>; last: CoalesceRef | null } {
  const coalesce =
    tag !== undefined &&
    last !== null &&
    last.tag === tag &&
    now - last.time < COALESCE_WINDOW_MS;

  if (coalesce) {
    return {
      state: { ...state, present: next },
      last: { tag, time: now }
    };
  }

  return {
    state: {
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.present],
      present: next,
      future: []
    },
    last: tag === undefined ? null : { tag, time: now }
  };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) {
    return state;
  }

  const previous = state.past[state.past.length - 1];

  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future].slice(0, HISTORY_LIMIT)
  };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) {
    return state;
  }

  const next = state.future[0];

  return {
    past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.present],
    present: next,
    future: state.future.slice(1)
  };
}
