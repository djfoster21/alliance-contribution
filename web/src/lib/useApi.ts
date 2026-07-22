import { useEffect, useState } from "react";
import { ApiError } from "./api";

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/**
 * Minimal data-fetching hook: runs `fn` on mount and whenever `deps` change,
 * tracking loading/error/data. Ignores results from stale calls. No cache — YAGNI.
 */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fn()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof ApiError ? err.message : (err as Error).message;
        setState({ data: null, loading: false, error: message });
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/**
 * Convention for pages with multiple `useApi` dependencies: surface the FIRST error across
 * all of them, so a failure in any fetch (not just the primary one) is shown rather than
 * silently degrading the UI. Returns null when none errored.
 */
export function firstError(...states: ApiState<unknown>[]): string | null {
  for (const state of states) {
    if (state.error) return state.error;
  }
  return null;
}
