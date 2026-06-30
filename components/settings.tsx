"use client";

import { useState } from "react";
import Link from "next/link";
import type { SettingsState } from "@/lib/settings";

export function Settings({ initial }: { initial: SettingsState }) {
  const [active, setActive] = useState(initial.active);
  const [choice, setChoice] = useState(initial.active);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(body.error ?? "Couldn't save — try again.");
        return;
      }
      const next = (await res.json()) as SettingsState;
      setActive(next.active);
      setChoice(next.active);
      setStatus("Saved.");
    } catch {
      // Network failure before any response (e.g. the backend proxy is down).
      setStatus("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rise mt-10 max-w-md">
      <h1 className="font-display text-3xl font-medium tracking-tight">Settings</h1>
      <p className="mt-2 text-ink-soft">Choose which AI model Folio uses for everything — curriculum, slides, quizzes, and the tutor.</p>

      <fieldset className="mt-8">
        <legend className="text-xs uppercase tracking-[0.18em] text-ink-faint">
          AI model
        </legend>
        <div className="mt-4 flex flex-col gap-3">
          {initial.providers.map((p) => (
            <label
              key={p.id}
              className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                p.available
                  ? "border-line hover:border-ink-faint cursor-pointer"
                  : "border-line opacity-60 cursor-not-allowed"
              } ${choice === p.id ? "border-accent bg-paper-raised" : ""}`}
            >
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={choice === p.id}
                disabled={!p.available}
                onChange={() => setChoice(p.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{p.label}</span>
                <span className="block text-sm text-ink-faint">
                  {p.id === "glm"
                    ? p.available
                      ? "Zhipu GLM via z.ai."
                      : "Set GLM_API_KEY to enable."
                    : "Anthropic Claude (API key, or the local Claude CLI)."}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || choice === active}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {status && <span className="text-sm text-ink-soft">{status}</span>}
      </div>

      <Link
        href="/"
        className="mt-10 inline-block text-sm text-ink-soft hover:text-ink transition-colors"
      >
        ← Back to library
      </Link>
    </section>
  );
}
