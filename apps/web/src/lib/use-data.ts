"use client";

import { useEffect, useState } from "react";

export type DataState<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: unknown };

/**
 * Loads data for a page and reloads it when `key` changes or `reload()` is called. Optionally
 * polls every `refreshMs`. State is only set from the async result, never during render.
 */
export function useData<T>(
  key: string,
  load: () => Promise<T>,
  refreshMs?: number,
): DataState<T> & { reload: () => void } {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; state: DataState<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      load().then(
        (data) => !cancelled && setResult({ key, state: { status: "ready", data } }),
        (error: unknown) => !cancelled && setResult({ key, state: { status: "error", error } }),
      );
    void run();
    const timer = refreshMs ? setInterval(() => void run(), refreshMs) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `load` is recreated every render; `key` and `version` say when to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, refreshMs]);

  // A result for an older key (e.g. the previous chart range) counts as still loading.
  const state: DataState<T> = result?.key === key ? result.state : { status: "loading" };
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
