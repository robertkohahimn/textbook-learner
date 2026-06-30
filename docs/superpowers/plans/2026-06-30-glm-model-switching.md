# GLM Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GLM (Zhipu AI) as an alternative LLM backend to Claude, switchable at runtime from a new Settings page.

**Architecture:** Reuse the existing `LlmProvider` abstraction. GLM is reached via z.ai's Anthropic-compatible endpoint, so it reuses the Anthropic SDK through a shared base class. Provider selection becomes runtime-dynamic: a global `active_provider` setting is persisted in SQLite and read by `getLlm()` on each call, so switching needs no restart.

**Tech Stack:** Next.js 16.2.9 (App Router, non-standard build), React 19.2.4, better-sqlite3, `@anthropic-ai/sdk` ^0.104.1, vitest, Tailwind CSS v4.

## Global Constraints

Every task implicitly includes these.

- **Package manager is npm, not pnpm.** Worktrees ship no `node_modules` — if absent, run `npm ci` before anything else.
- **Next.js here is non-standard** (see `AGENTS.md`). Before writing any Next.js route/page code, read the relevant guide under `node_modules/next/dist/docs/`. Heed deprecation notices.
- **Typecheck command:** `node_modules/.bin/tsc --noEmit -p tsconfig.json`. Bare `tsc`/`npx tsc` is hijacked by a global shim and will not work. tsconfig is `strict` (no `noUnusedLocals`); there is no ESLint.
- **Tests:** `npm test` (`vitest run`). Test files live in `tests/` named `*.test.ts`. Only `lib/` pure logic is unit-tested — there is no React/DOM harness. Path alias `@` → repo root.
- **Build gate:** `npm run build` typechecks end-to-end and is a valid CI-style check.
- **Provider interface is fixed:** `LlmProvider` = `generate(prompt, opts?)` + `stream(prompt, opts?)` (`lib/llm/types.ts`). Do not change it.
- **GLM auth (verified):** z.ai authenticates with `Authorization: Bearer` — use the SDK's `authToken`, and pass `apiKey: null` to suppress the SDK's env-default `x-api-key`. Base URL default `https://api.z.ai/api/anthropic`. Default model `glm-4.7` (plan-dependent; overridable via `GLM_MODEL`).
- **Health labels are a contract:** keep emitting `"anthropic-api"` and `"claude-cli"`; only add `"glm"`. Do not rename them.
- **Spec:** `docs/superpowers/specs/2026-06-30-glm-model-switching-design.md`.

---

### Task 1: Settings store in SQLite

A generic key/value `settings` table plus typed accessors for the active provider. Foundation for the route, page, health endpoint, and dynamic `getLlm()`.

**Files:**
- Modify: `lib/db.ts` (add table to `SCHEMA`; append accessor functions)
- Test: `tests/settings.test.ts` (create)

**Interfaces:**
- Produces:
  - `getSetting(key: string): string | undefined`
  - `setSetting(key: string, value: string): void`
  - `type ActiveProvider = "claude" | "glm"`
  - `getActiveProvider(): ActiveProvider` (defaults to `"claude"` when unset/unknown)
  - `setActiveProvider(provider: ActiveProvider): void`

- [ ] **Step 1: Write the failing test**

Create `tests/settings.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let db: typeof import("@/lib/db");

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "tbl-settings-"));
  db = await import("@/lib/db");
});

describe("settings store", () => {
  it("returns undefined for an unset key", () => {
    expect(db.getSetting("nope")).toBeUndefined();
  });

  it("round-trips a value and overwrites on conflict", () => {
    db.setSetting("active_provider", "glm");
    expect(db.getSetting("active_provider")).toBe("glm");
    db.setSetting("active_provider", "claude");
    expect(db.getSetting("active_provider")).toBe("claude");
  });

  it("defaults active provider to claude when unset or unrecognized", () => {
    db.setSetting("active_provider", "weird-value");
    expect(db.getActiveProvider()).toBe("claude");
    db.setActiveProvider("glm");
    expect(db.getActiveProvider()).toBe("glm");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/settings.test.ts`
Expected: FAIL — `db.getSetting is not a function` (exports do not exist yet).

- [ ] **Step 3: Add the settings table to the schema**

In `lib/db.ts`, inside the `SCHEMA` template literal, add this table immediately after the `slide_annotations` table (before the closing `` ` `` near line 167):

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 4: Append the accessor functions**

At the end of `lib/db.ts`, append:

```ts
// --- settings (app-wide key/value) ---

export type ActiveProvider = "claude" | "glm";

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function getActiveProvider(): ActiveProvider {
  // Any value other than "glm" (including absent or corrupt) means Claude.
  return getSetting("active_provider") === "glm" ? "glm" : "claude";
}

export function setActiveProvider(provider: ActiveProvider): void {
  setSetting("active_provider", provider);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck and run the full suite (no regressions)**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: no type errors; all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts tests/settings.test.ts
git commit -m "feat(db): add key/value settings store and active-provider accessors"
```

---

### Task 2: Pure provider resolver

A pure function mapping the user-facing selection + env to a concrete provider id. This is the testable core of provider selection; it has no I/O.

**Files:**
- Create: `lib/llm/resolve.ts`
- Test: `tests/resolve.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = "claude-api" | "claude-cli" | "glm"`
  - `resolveActiveProviderId(selected: "claude" | "glm", env: { ANTHROPIC_API_KEY?: string }): ProviderId`

- [ ] **Step 1: Write the failing test**

Create `tests/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveActiveProviderId } from "@/lib/llm/resolve";

describe("resolveActiveProviderId", () => {
  it("selects glm whenever glm is chosen, regardless of the anthropic key", () => {
    expect(resolveActiveProviderId("glm", {})).toBe("glm");
    expect(resolveActiveProviderId("glm", { ANTHROPIC_API_KEY: "sk" })).toBe("glm");
  });

  it("selects the anthropic api when claude is chosen and a key is present", () => {
    expect(resolveActiveProviderId("claude", { ANTHROPIC_API_KEY: "sk" })).toBe(
      "claude-api"
    );
  });

  it("falls back to the claude cli when claude is chosen and no key is present", () => {
    expect(resolveActiveProviderId("claude", {})).toBe("claude-cli");
    expect(resolveActiveProviderId("claude", { ANTHROPIC_API_KEY: "" })).toBe(
      "claude-cli"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/resolve.test.ts`
Expected: FAIL — cannot find module `@/lib/llm/resolve`.

- [ ] **Step 3: Write the implementation**

Create `lib/llm/resolve.ts`:

```ts
export type ProviderId = "claude-api" | "claude-cli" | "glm";

/**
 * Map the user-facing selection + environment to a concrete provider id. Pure: no I/O,
 * so it is fully unit-tested. "claude" preserves the original env-based behavior
 * (Anthropic API when a key is set, otherwise the local claude CLI).
 */
export function resolveActiveProviderId(
  selected: "claude" | "glm",
  env: { ANTHROPIC_API_KEY?: string }
): ProviderId {
  if (selected === "glm") return "glm";
  return env.ANTHROPIC_API_KEY ? "claude-api" : "claude-cli";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/resolve.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/llm/resolve.ts tests/resolve.test.ts
git commit -m "feat(llm): add pure provider-id resolver"
```

---

### Task 3: Shared Anthropic-compatible base + GLM provider

Extract the duplicated Anthropic `generate`/`stream` logic into a base class, reslim `AnthropicProvider` onto it, and add `GlmProvider` pointed at z.ai.

**Files:**
- Create: `lib/llm/anthropic-compatible.ts`
- Modify: `lib/llm/anthropic.ts` (reduce to a subclass)
- Create: `lib/llm/glm.ts`
- Test: `tests/glm.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `LlmOptions` from `./types`.
- Produces:
  - `class AnthropicCompatibleProvider implements LlmProvider` — `constructor(client: Anthropic, model: string, maxTokens?: number)`
  - `class AnthropicProvider extends AnthropicCompatibleProvider` — `constructor()` (unchanged external behavior)
  - `class GlmProvider extends AnthropicCompatibleProvider` — `constructor()`; throws if `GLM_API_KEY` is unset.

- [ ] **Step 1: Write the failing test**

Create `tests/glm.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("GlmProvider", () => {
  let savedKey: string | undefined;
  beforeAll(() => {
    savedKey = process.env.GLM_API_KEY;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = savedKey;
  });

  it("throws a clear error when GLM_API_KEY is missing", async () => {
    delete process.env.GLM_API_KEY;
    const { GlmProvider } = await import("@/lib/llm/glm");
    expect(() => new GlmProvider()).toThrow(/GLM_API_KEY/);
  });
});

// Live check — only runs when LIVE=1 and a real GLM key is present.
describe.skipIf(!process.env.LIVE || !process.env.GLM_API_KEY)(
  "GlmProvider (live)",
  () => {
    it("generates a one-shot completion via z.ai", async () => {
      const { GlmProvider } = await import("@/lib/llm/glm");
      const out = await new GlmProvider().generate(
        "Reply with exactly the word OK and nothing else."
      );
      expect(out.toUpperCase()).toContain("OK");
    });
  }
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/glm.test.ts`
Expected: FAIL — cannot find module `@/lib/llm/glm`.

- [ ] **Step 3: Create the shared base**

Create `lib/llm/anthropic-compatible.ts` (this is the existing `anthropic.ts` body, parameterized by an injected client + model):

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmOptions, LlmProvider } from "./types";

/** Shared implementation for any Anthropic Messages API-compatible endpoint. */
export class AnthropicCompatibleProvider implements LlmProvider {
  constructor(
    protected readonly client: Anthropic,
    protected readonly model: string,
    protected readonly maxTokens = 8192
  ) {}

  async generate(prompt: string, opts?: LlmOptions): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: opts?.system,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  async *stream(prompt: string, opts?: LlmOptions): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: opts?.system,
      messages: [{ role: "user", content: prompt }],
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}
```

- [ ] **Step 4: Reslim `anthropic.ts` onto the base**

Replace the entire contents of `lib/llm/anthropic.ts` with:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicCompatibleProvider } from "./anthropic-compatible";

const MODEL = process.env.LLM_MODEL?.startsWith("claude-")
  ? process.env.LLM_MODEL
  : "claude-sonnet-4-6";

export class AnthropicProvider extends AnthropicCompatibleProvider {
  constructor() {
    super(new Anthropic(), MODEL);
  }
}
```

- [ ] **Step 5: Create the GLM provider**

Create `lib/llm/glm.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicCompatibleProvider } from "./anthropic-compatible";

const BASE_URL = process.env.GLM_BASE_URL ?? "https://api.z.ai/api/anthropic";
// Plan-dependent: must name a model GA and entitled on the user's z.ai plan.
const MODEL = process.env.GLM_MODEL ?? "glm-4.7";

export class GlmProvider extends AnthropicCompatibleProvider {
  constructor() {
    const key = process.env.GLM_API_KEY;
    if (!key) throw new Error("GLM_API_KEY is not set. Set it to use GLM.");
    // z.ai authenticates via `Authorization: Bearer` (authToken), NOT x-api-key.
    // apiKey is nulled so the SDK does not also attach x-api-key from a process-level
    // ANTHROPIC_API_KEY — two conflicting auth headers would leak Claude's key to z.ai.
    super(new Anthropic({ baseURL: BASE_URL, apiKey: null, authToken: key }), MODEL);
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tests/glm.test.ts`
Expected: PASS (1 test; the live block is skipped without `LIVE`).

- [ ] **Step 7: Typecheck and run the full suite**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: no type errors; `tests/llm.test.ts` and all others still pass (claude-cli is untouched; the Anthropic refactor is behavior-preserving).

- [ ] **Step 8: Commit**

```bash
git add lib/llm/anthropic-compatible.ts lib/llm/anthropic.ts lib/llm/glm.ts tests/glm.test.ts
git commit -m "feat(llm): share Anthropic-compatible base and add GlmProvider (z.ai)"
```

---

### Task 4: Dynamic `getLlm()`

Make `getLlm()` resolve the provider per call from the persisted setting + env, memoizing one instance per resolved id. The selector is injected so the module stays testable without a database.

**Files:**
- Modify: `lib/llm/index.ts` (rewrite)
- Test: `tests/get-llm.test.ts`

**Interfaces:**
- Consumes: `resolveActiveProviderId`, `ProviderId` (Task 2); `GlmProvider` (Task 3); `AnthropicProvider`, `ClaudeCliProvider`; `getActiveProvider` (Task 1).
- Produces: `getLlm(getSelected?: () => "claude" | "glm"): LlmProvider` (default selector = `getActiveProvider`).

- [ ] **Step 1: Write the failing test**

Create `tests/get-llm.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLlm } from "@/lib/llm";
import { GlmProvider } from "@/lib/llm/glm";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { ClaudeCliProvider } from "@/lib/llm/claude-cli";

let savedAnthropic: string | undefined;
let savedGlm: string | undefined;

beforeAll(() => {
  savedAnthropic = process.env.ANTHROPIC_API_KEY;
  savedGlm = process.env.GLM_API_KEY;
});
afterAll(() => {
  if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  if (savedGlm === undefined) delete process.env.GLM_API_KEY;
  else process.env.GLM_API_KEY = savedGlm;
});

describe("getLlm provider resolution", () => {
  it("returns a GlmProvider when the injected selector picks glm", () => {
    process.env.GLM_API_KEY = "test-key";
    expect(getLlm(() => "glm")).toBeInstanceOf(GlmProvider);
  });

  it("returns an AnthropicProvider for claude when an anthropic key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(getLlm(() => "claude")).toBeInstanceOf(AnthropicProvider);
  });

  it("returns a ClaudeCliProvider for claude when no anthropic key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getLlm(() => "claude")).toBeInstanceOf(ClaudeCliProvider);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/get-llm.test.ts`
Expected: FAIL — `getLlm(() => "glm")` returns the old env-cached provider (not a `GlmProvider`), and/or `getLlm` ignores its argument.

- [ ] **Step 3: Rewrite `lib/llm/index.ts`**

Replace the entire contents of `lib/llm/index.ts` with:

```ts
import type { LlmProvider } from "./types";
import { ClaudeCliProvider } from "./claude-cli";
import { AnthropicProvider } from "./anthropic";
import { GlmProvider } from "./glm";
import { resolveActiveProviderId, type ProviderId } from "./resolve";
import { getActiveProvider } from "../db";

export type { LlmProvider, LlmOptions } from "./types";

const cache = new Map<ProviderId, LlmProvider>();

function construct(id: ProviderId): LlmProvider {
  switch (id) {
    case "glm":
      return new GlmProvider();
    case "claude-api":
      return new AnthropicProvider();
    case "claude-cli":
      return new ClaudeCliProvider();
  }
}

/**
 * The active LLM provider, resolved per call from the persisted setting + env so a
 * Settings change takes effect without a restart. Instances are memoized per resolved id.
 *
 * The selector is injected (default = the DB-backed getActiveProvider) so this stays unit-
 * testable with a stub and no database. getDb() is lazy, so merely importing this module
 * does not open a database — only calling the default selector does.
 */
export function getLlm(
  getSelected: () => "claude" | "glm" = getActiveProvider
): LlmProvider {
  const id = resolveActiveProviderId(getSelected(), process.env);
  let provider = cache.get(id);
  if (!provider) {
    provider = construct(id);
    cache.set(id, provider);
  }
  return provider;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/get-llm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and run the full suite**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: no type errors; all tests pass. (The four `getLlm()` call sites — `lib/curriculum.ts`, `lib/materials.ts`, `lib/deck-generate.ts`, `app/api/lessons/[lessonId]/tutor/route.ts` — call `getLlm()` with no args and need no changes.)

- [ ] **Step 6: Commit**

```bash
git add lib/llm/index.ts tests/get-llm.test.ts
git commit -m "feat(llm): resolve active provider at runtime from the settings store"
```

---

### Task 5: Settings helpers + `/api/settings` route

A small pure helper module for the settings view-state, plus the GET/POST route. Keeping the helpers pure lets them carry the automated coverage; the route is a thin wrapper verified by curl + build (the project does not unit-test routes).

**Files:**
- Create: `lib/settings.ts`
- Test: `tests/settings-helpers.test.ts`
- Create: `app/api/settings/route.ts`

**Interfaces:**
- Consumes: `getActiveProvider`, `setActiveProvider`, `ActiveProvider` (Task 1).
- Produces:
  - `type ProviderInfo = { id: ActiveProvider; label: string; available: boolean }`
  - `type SettingsState = { active: ActiveProvider; providers: ProviderInfo[] }`
  - `providerInfos(env?): ProviderInfo[]`
  - `isProviderAvailable(id: string, env?): boolean`
  - `settingsState(): SettingsState`
  - Route handlers `GET()` and `POST(req)`.

- [ ] **Step 1: Write the failing test**

Create `tests/settings-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { providerInfos, isProviderAvailable } from "@/lib/settings";

describe("providerInfos", () => {
  it("always marks claude available; glm depends on GLM_API_KEY", () => {
    const withKey = providerInfos({ GLM_API_KEY: "z" });
    expect(withKey.find((p) => p.id === "claude")?.available).toBe(true);
    expect(withKey.find((p) => p.id === "glm")?.available).toBe(true);

    const withoutKey = providerInfos({});
    expect(withoutKey.find((p) => p.id === "glm")?.available).toBe(false);
  });
});

describe("isProviderAvailable", () => {
  it("is true for claude, and for glm only with a key", () => {
    expect(isProviderAvailable("claude", {})).toBe(true);
    expect(isProviderAvailable("glm", {})).toBe(false);
    expect(isProviderAvailable("glm", { GLM_API_KEY: "z" })).toBe(true);
    expect(isProviderAvailable("nonsense", { GLM_API_KEY: "z" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/settings-helpers.test.ts`
Expected: FAIL — cannot find module `@/lib/settings`.

- [ ] **Step 3: Write the helpers**

Create `lib/settings.ts`:

```ts
import { getActiveProvider, type ActiveProvider } from "./db";

export type ProviderInfo = {
  id: ActiveProvider;
  label: string;
  available: boolean;
};
export type SettingsState = {
  active: ActiveProvider;
  providers: ProviderInfo[];
};

/** Claude is always available (it falls back to the local CLI); GLM needs a key. */
export function providerInfos(
  env: { GLM_API_KEY?: string } = process.env
): ProviderInfo[] {
  return [
    { id: "claude", label: "Claude", available: true },
    { id: "glm", label: "GLM", available: Boolean(env.GLM_API_KEY) },
  ];
}

export function isProviderAvailable(
  id: string,
  env: { GLM_API_KEY?: string } = process.env
): boolean {
  return providerInfos(env).some((p) => p.id === id && p.available);
}

export function settingsState(): SettingsState {
  return { active: getActiveProvider(), providers: providerInfos() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/settings-helpers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the route**

First read `node_modules/next/dist/docs/` for the current route-handler guide (per Global Constraints). Then create `app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { setActiveProvider } from "@/lib/db";
import { isProviderAvailable, settingsState } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(settingsState());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { provider?: string } | null;
  const provider = body?.provider;
  if (provider !== "claude" && provider !== "glm") {
    return NextResponse.json(
      { error: "provider must be 'claude' or 'glm'" },
      { status: 400 }
    );
  }
  if (!isProviderAvailable(provider)) {
    return NextResponse.json(
      { error: "GLM is not configured. Set GLM_API_KEY to enable it." },
      { status: 400 }
    );
  }
  setActiveProvider(provider);
  return NextResponse.json(settingsState());
}
```

- [ ] **Step 6: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no type errors.

- [ ] **Step 7: Verify the route end-to-end with the dev server**

Start the dev server in one shell: `npm run dev` (serves on `http://localhost:3000`). In another shell:

```bash
# GET default (no GLM_API_KEY in this shell): active=claude, glm unavailable
curl -s localhost:3000/api/settings
# Expect: {"active":"claude","providers":[{"id":"claude",...,"available":true},{"id":"glm",...,"available":false}]}

# Rejected: unknown provider
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/settings \
  -H 'content-type: application/json' -d '{"provider":"gpt"}'
# Expect: 400

# Rejected: glm without a key
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/settings \
  -H 'content-type: application/json' -d '{"provider":"glm"}'
# Expect: 400

# Accepted: switch to claude (always available), persists
curl -s -X POST localhost:3000/api/settings \
  -H 'content-type: application/json' -d '{"provider":"claude"}'
# Expect: {"active":"claude",...}
```

Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add lib/settings.ts tests/settings-helpers.test.ts app/api/settings/route.ts
git commit -m "feat(settings): add settings view-state helpers and /api/settings route"
```

---

### Task 6: Settings page, form component, and nav link

The user-facing Settings page with a Claude/GLM radio selector and Save, plus a link to reach it from the library header.

**Files:**
- Create: `components/settings.tsx` (client)
- Create: `app/settings/page.tsx` (server)
- Modify: `components/library.tsx` (add a Settings link to the header)

**Interfaces:**
- Consumes: `SettingsState` shape from `lib/settings` (`{ active, providers: [{ id, label, available }] }`); `getActiveProvider`, env (Task 1/5); `Wordmark` from `components/bits`.
- Produces: `Settings({ initial }: { initial: SettingsState })` default-exported page at route `/settings`.

- [ ] **Step 1: Create the client form component**

Create `components/settings.tsx`:

```tsx
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
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: choice }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus(body.error ?? "Couldn't save — try again.");
      return;
    }
    const next = (await res.json()) as SettingsState;
    setActive(next.active);
    setChoice(next.active);
    setStatus("Saved.");
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
```

- [ ] **Step 2: Create the server page**

First read `node_modules/next/dist/docs/` for the current page/server-component guide. Then create `app/settings/page.tsx`:

```tsx
import { Settings } from "@/components/settings";
import { Wordmark } from "@/components/bits";
import { settingsState } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <header className="flex items-center justify-between py-8">
        <Wordmark />
      </header>
      <Settings initial={settingsState()} />
    </main>
  );
}
```

- [ ] **Step 3: Add a Settings link to the library header**

In `components/library.tsx`, replace the header block (around lines 53-55):

```tsx
      <header className="flex items-center justify-between py-8">
        <Wordmark />
      </header>
```

with:

```tsx
      <header className="flex items-center justify-between py-8">
        <Wordmark />
        <Link
          href="/settings"
          className="text-sm text-ink-soft hover:text-ink transition-colors"
        >
          Settings
        </Link>
      </header>
```

(`Link` is already imported in `components/library.tsx`.)

- [ ] **Step 4: Typecheck and build**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run build`
Expected: no type errors; build succeeds, with `/settings` and `/api/settings` listed among the routes.

- [ ] **Step 5: Manual verification**

Start `npm run dev`. In a browser:
1. Open `http://localhost:3000` — confirm a "Settings" link in the header.
2. Click it → `/settings` renders with two options. With no `GLM_API_KEY`, the GLM option is disabled and reads "Set GLM_API_KEY to enable."; Save is disabled until the choice differs from the current value.
3. Select Claude (if not already), Save → "Saved." appears.
4. Restart the dev server with `GLM_API_KEY=test-key npm run dev`, reload `/settings` → GLM is now selectable; choosing GLM + Save shows "Saved." and persists (reload keeps GLM selected).

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add components/settings.tsx app/settings/page.tsx components/library.tsx
git commit -m "feat(ui): add Settings page with Claude/GLM switch and header link"
```

---

### Task 7: Report the active provider on the health endpoint

Update `/api/health` to reflect the resolved active provider, preserving the existing label strings.

**Files:**
- Modify: `app/api/health/route.ts` (rewrite)

**Interfaces:**
- Consumes: `getActiveProvider` (Task 1), `resolveActiveProviderId` (Task 2).

- [ ] **Step 1: Rewrite the health route**

Replace the entire contents of `app/api/health/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getActiveProvider } from "@/lib/db";
import { resolveActiveProviderId } from "@/lib/llm/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preserve the existing external label strings; only add "glm".
const LABELS = {
  "claude-api": "anthropic-api",
  "claude-cli": "claude-cli",
  glm: "glm",
} as const;

export function GET() {
  const id = resolveActiveProviderId(getActiveProvider(), process.env);
  return NextResponse.json({ ok: true, llm: LABELS[id] });
}
```

- [ ] **Step 2: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no type errors.

- [ ] **Step 3: Verify with the dev server**

Start `npm run dev`. Then:

```bash
# Default: active=claude, no ANTHROPIC_API_KEY in this shell -> claude-cli
curl -s localhost:3000/api/health
# Expect: {"ok":true,"llm":"claude-cli"}
```

To confirm the GLM branch: set GLM via `curl -X POST .../api/settings -d '{"provider":"glm"}'` (with `GLM_API_KEY` set on the server), then `curl localhost:3000/api/health` → `{"ok":true,"llm":"glm"}`. Switch back to claude afterward. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/health/route.ts
git commit -m "feat(health): report the resolved active LLM provider"
```

---

### Task 8: Document env vars and run the GLM integration smoke test (definition of done)

Document the new configuration and perform the mandatory live verification that GLM actually generates and streams through z.ai. This is the gate that catches an auth-header, model-id, base-URL, or SSE-shape mismatch — none of which a unit test can prove.

**Files:**
- Modify: `README.md` (env var documentation)

**Prerequisite:** a real z.ai API key and a valid GLM model id for that plan.

- [ ] **Step 1: Document the new environment variables**

In `README.md`, in the configuration/environment section (alongside the existing `ANTHROPIC_API_KEY` / `LLM_MODEL` documentation), add:

```markdown
### GLM (Zhipu AI) as an alternative model

Folio can use GLM via z.ai's Anthropic-compatible endpoint. Switch models at runtime on
the **Settings** page (`/settings`); the choice is global and applies to curriculum,
slides, quizzes, and the tutor.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GLM_API_KEY` | _(unset)_ | z.ai API key. Required to enable/select GLM. Sent as `Authorization: Bearer`. |
| `GLM_MODEL` | `glm-4.7` | GLM model id. Must be GA and entitled on your z.ai plan. |
| `GLM_BASE_URL` | `https://api.z.ai/api/anthropic` | z.ai Anthropic-compatible base URL. Use `https://api.z.ai/api/coding/paas/v4` for the coding-plan quota. |

With no `GLM_API_KEY`, the GLM option is disabled in Settings and Folio behaves exactly
as before (Anthropic API when `ANTHROPIC_API_KEY` is set, otherwise the local `claude` CLI).
```

- [ ] **Step 2: Run the live GLM unit smoke test (one-shot generate)**

With a real key in the environment:

Run: `LIVE=1 GLM_API_KEY=<real-key> npm test -- tests/glm.test.ts`
Expected: the `GlmProvider (live)` block runs and PASSES (output contains "OK"). This proves auth header + model id + base URL are correct end to end. If it 401s, the key/auth is wrong; if it 404s/400s on the model, fix `GLM_MODEL`.

- [ ] **Step 3: Run the mandatory streaming smoke test against a running app**

Start the server with GLM configured and selected:

```bash
GLM_API_KEY=<real-key> npm run dev
```

Then set GLM active and exercise the streamed tutor path against a real lesson:

```bash
# 1. Switch to GLM
curl -s -X POST localhost:3000/api/settings \
  -H 'content-type: application/json' -d '{"provider":"glm"}'
# Expect: {"active":"glm",...}

# 2. Confirm health reflects it
curl -s localhost:3000/api/health
# Expect: {"ok":true,"llm":"glm"}

# 3. Stream a tutor reply for an existing lesson and assert NON-EMPTY output.
#    (Replace <LESSON_ID> with a ready lesson; GET /api/books shows books, drill into one.)
curl -sN -X POST "localhost:3000/api/lessons/<LESSON_ID>/tutor" \
  -H 'content-type: application/json' \
  -d '{"question":"In one sentence, what is this lesson about?"}'
# Expect: a streamed, non-empty text response.
```

**Acceptance:** step 3 must produce non-empty streamed text. If it streams nothing while
`generate()` (Step 2) works, z.ai's SSE event shape differs from Anthropic's
`content_block_delta`/`text_delta`; inspect the raw stream and adjust
`AnthropicCompatibleProvider.stream()` accordingly before considering the feature done.

Switch back to Claude afterward (`curl -X POST .../api/settings -d '{"provider":"claude"}'`)
and stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document GLM env vars and model switching"
```

---

## Notes for the implementer

- **Worktree preflight:** if `node_modules` is missing, run `npm ci` first (npm, never pnpm).
- **The four `getLlm()` call sites are untouched** — they call `getLlm()` with no args and pick up the active provider automatically.
- **Mid-flight switching:** an in-progress generation keeps its provider; the next queued job uses the new one. This is acceptable (the job queue is serial).
- **`lib/settings.ts` is new** relative to the spec's file table — it was added during planning to keep the route and page DRY around one view-state shape. Everything else matches the spec.
