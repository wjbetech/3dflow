import { useCallback, useRef, useState } from "react";
import {
  pushChange,
  redo as redoState,
  undo as undoState,
  type CoalesceRef,
  type HistoryState
} from "./history";

export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: []
  });
  const lastCoalesce = useRef<CoalesceRef | null>(null);

  const update = useCallback((updater: (previous: T) => T, tag?: string) => {
    setState((current) => {
      const result = pushChange(
        current,
        updater(current.present),
        tag,
        Date.now(),
        lastCoalesce.current
      );

      lastCoalesce.current = result.last;
      return result.state;
    });
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      const next = undoState(current);

      if (next !== current) {
        lastCoalesce.current = null;
      }

      return next;
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = redoState(current);

      if (next !== current) {
        lastCoalesce.current = null;
      }

      return next;
    });
  }, []);

  return {
    present: state.present,
    update,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0
  };
}
