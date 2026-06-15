"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(url: string, intervalMs: number, initialActive: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(initialActive);

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

  const setActive = useCallback((next: boolean) => {
    activeRef.current = next;
  }, []);

  return { data, error, refresh, setActive };
}
