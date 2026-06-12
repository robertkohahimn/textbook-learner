"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetch JSON from `url` immediately, then keep refetching every `intervalMs`
 * while `active` is true. Returns the latest data plus a manual refresh.
 */
export function usePoll<T>(url: string, intervalMs: number, active: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setData((await res.json()) as T);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (activeRef.current) void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
