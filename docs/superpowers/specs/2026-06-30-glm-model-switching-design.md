# GLM as an alternative model, with a Settings page to switch

**Date:** 2026-06-30
**Status:** Approved — ready for implementation plan

## Goal

Let Folio use **GLM** (Zhipu AI) as an alternative LLM backend to Claude, and let the
user switch between them at runtime from a new **Settings** page. The choice is global
(applies to curriculum, slides, quiz, and tutor) and takes effect without a restart.

## Background

The app already has a clean provider abstraction in `lib/llm/`:

- `lib/llm/types.ts` — `LlmProvider` interface: `generate(prompt, opts)` and
  `stream(prompt, opts)`.
- `lib/llm/index.ts` — `getLlm()` picks a provider **once** at process start
  (`ANTHROPIC_API_KEY ? AnthropicProvider : ClaudeCliProvider`) and caches it in a
  module singleton.
- `lib/llm/anthropic.ts` — uses `@anthropic-ai/sdk` (reads `ANTHROPIC_API_KEY`
  automatically); model from `LLM_MODEL` (default `claude-sonnet-4-6`).
- `lib/llm/claude-cli.ts` — spawns the `claude` CLI headless; model from `LLM_MODEL`
  (default `sonnet`).

`getLlm()` is the single entry point used by `lib/curriculum.ts`, `lib/materials.ts`,
`lib/deck-generate.ts`, and `app/api/lessons/[lessonId]/tutor/route.ts`. Selection is
currently **env-var-driven only** — there is no settings table, no settings UI.

GLM is reachable through z.ai's **Anthropic-compatible** endpoint
(`https://api.z.ai/api/anthropic`), so the existing Anthropic SDK code — including the
streaming event handling — is reused verbatim; only the base URL, key, and model id
differ.

## Decisions (from brainstorming)

- **GLM endpoint:** z.ai Anthropic-compatible (reuse the Anthropic SDK).
- **Credentials:** environment variable only (`GLM_API_KEY`). No secret is typed into
  the browser or stored in SQLite. The Settings page only switches the active provider.
- **Scope:** global / app-wide (single active model for all generation and the tutor).

## Architecture

### 1. Provider layer (`lib/llm/`)

**Shared base — `AnthropicCompatibleProvider`.** Extract the duplicated
`generate()`/`stream()` logic out of `anthropic.ts` into a base class parameterized by a
constructed SDK client, a model id, and a max-tokens value. The streaming logic
(`content_block_delta` → `text_delta`) lives here once.

```ts
// lib/llm/anthropic-compatible.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmOptions, LlmProvider } from "./types";

export class AnthropicCompatibleProvider implements LlmProvider {
  constructor(
    protected client: Anthropic,
    protected model: string,
    protected maxTokens = 8192,
  ) {}
  async generate(prompt: string, opts?: LlmOptions): Promise<string> { /* moved from anthropic.ts */ }
  async *stream(prompt: string, opts?: LlmOptions): AsyncIterable<string> { /* moved from anthropic.ts */ }
}
```

**`AnthropicProvider`** becomes a thin subclass: `new Anthropic()` client +
`LLM_MODEL`-derived model (unchanged default `claude-sonnet-4-6`).

**`GlmProvider` (new, `lib/llm/glm.ts`)** is a thin subclass:

```ts
const BASE_URL = process.env.GLM_BASE_URL ?? "https://api.z.ai/api/anthropic";
// Plan-dependent. Must name a model that is GA and entitled on the user's z.ai plan.
// As of 2026-06 the current line is GLM-4.7 / GLM-5.2; glm-4.6 is a prior generation.
const MODEL = process.env.GLM_MODEL ?? "glm-4.7";

export class GlmProvider extends AnthropicCompatibleProvider {
  constructor() {
    const key = process.env.GLM_API_KEY;
    if (!key) throw new Error("GLM_API_KEY is not set. Set it to use GLM.");
    // z.ai authenticates via `Authorization: Bearer` (its ANTHROPIC_AUTH_TOKEN), NOT
    // `x-api-key`. Use the SDK's `authToken`. Pass `apiKey: null` explicitly so the SDK
    // does not ALSO read a process-level ANTHROPIC_API_KEY and attach `x-api-key`,
    // which would send two conflicting auth headers (and leak Claude's key to z.ai).
    super(new Anthropic({ baseURL: BASE_URL, apiKey: null, authToken: key }), MODEL);
  }
}
```

**Authentication (verified against z.ai docs).** z.ai's Anthropic-compatible endpoint
authenticates with `Authorization: Bearer <key>` (`ANTHROPIC_AUTH_TOKEN`), the same
mechanism Claude Code uses against it — **not** `x-api-key`. The SDK's `apiKey` option
emits `x-api-key`, so it is the wrong option here; `authToken` is correct. `apiKey` is
explicitly nulled to suppress the SDK's env-default `x-api-key` when `ANTHROPIC_API_KEY`
is also present (the Claude-API config). This is no longer an open unknown.

**Dynamic resolution.** Add a pure function and make `getLlm()` read the setting each
call, memoizing one instance per resolved id:

```ts
// lib/llm/resolve.ts  (pure, unit-tested)
export type ProviderId = "claude-api" | "claude-cli" | "glm";
export function resolveActiveProviderId(
  selected: "claude" | "glm",
  env: { ANTHROPIC_API_KEY?: string },
): ProviderId {
  if (selected === "glm") return "glm";
  return env.ANTHROPIC_API_KEY ? "claude-api" : "claude-cli";
}
```

```ts
// lib/llm/index.ts
const cache = new Map<ProviderId, LlmProvider>();

// Selector is injected, not imported, so lib/llm stays free of a lib/db dependency and
// remains unit-testable without an initialized SQLite database. The DB-backed default is
// wired at the composition root; tests pass a stub.
export function getLlm(
  getSelected: () => "claude" | "glm" = getActiveProvider,
): LlmProvider {
  const id = resolveActiveProviderId(getSelected(), process.env);
  let p = cache.get(id);
  if (!p) { p = construct(id); cache.set(id, p); }
  return p;
}
```

`construct(id)` maps `"claude-api" → AnthropicProvider`, `"claude-cli" →
ClaudeCliProvider`, `"glm" → GlmProvider`. Reading one settings row per `getLlm()` call
is a synchronous sub-ms SELECT, so runtime switching needs no restart and no manual cache
invalidation. In-flight jobs keep their already-constructed provider; the next job picks
up the new selection. (The serial in-process job queue means at most one generation is in
flight at a time.)

**Layer boundary.** `getActiveProvider` is the *default* selector but is injected as a
parameter rather than imported at the top of `lib/llm/index.ts`, so the LLM module does
not statically depend on `lib/db.ts`. This preserves `lib/llm`'s isolation: `getLlm()`
can be exercised in tests with a stub selector and no database. The DB-backed default is
bound at the call sites / composition root.

### 2. Persistence (`lib/db.ts`)

Add a generic key-value settings table to `SCHEMA` (idempotent `CREATE TABLE IF NOT
EXISTS`, no data migration needed since it is brand new):

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Helpers in `lib/db.ts`:

```ts
export function getSetting(key: string): string | undefined;
export function setSetting(key: string, value: string): void;  // INSERT … ON CONFLICT DO UPDATE
```

The active model is stored under key `active_provider` with value `"claude" | "glm"`.
A typed accessor `getActiveProvider(): "claude" | "glm"` returns `getSetting("active_provider")`
narrowed to the union, defaulting to `"claude"` when absent or unrecognized.

### 3. API route (`app/api/settings/route.ts`)

`runtime = "nodejs"`, `dynamic = "force-dynamic"`.

- **GET** → current state:
  ```json
  {
    "active": "claude",
    "providers": [
      { "id": "claude", "label": "Claude", "available": true },
      { "id": "glm", "label": "GLM", "available": false }
    ]
  }
  ```
  `claude.available` is always `true` (it falls back to the `claude` CLI when no API key
  is set). `glm.available` is `!!process.env.GLM_API_KEY`.
- **POST** `{ "provider": "claude" | "glm" }` → validate: 400 if the body is malformed or
  if the chosen provider is not available (e.g. GLM selected with no `GLM_API_KEY`).
  Otherwise `setSetting("active_provider", provider)` and return the new state (same shape
  as GET).

### 4. Settings page UI

- **`app/settings/page.tsx`** — server component; reads current state directly (via the
  `lib/db` helpers + env) and renders `<Settings initial={…} />`. A back-to-library link
  in the header.
- **`components/settings.tsx`** — client component. An "AI model" section with two radio
  options (Claude / GLM). An unavailable option is disabled with helper text
  ("Set GLM_API_KEY to enable"). A **Save** button POSTs to `/api/settings`; on success
  show a "Saved" confirmation; on 400 show the error. Styled in the existing "private
  library" aesthetic (paper/ink, Fraunces/Instrument Sans), matching the other components.
- **Navigation:** add a **Settings** (gear) link to the home/library header (in
  `components/library.tsx`, next to the wordmark).

### 5. Health + environment

- **`app/api/health/route.ts`** — report the resolved active provider using
  `getActiveProvider()` + `resolveActiveProviderId()`, instead of the current env-only
  check. **Preserve the existing external label strings** to avoid breaking any consumer
  keying on them: map the internal `ProviderId` → health label as
  `"claude-api" → "anthropic-api"`, `"claude-cli" → "claude-cli"`, `"glm" → "glm"`. The
  internal enum is not leaked to the response.
- **New env vars** (documented in README):
  - `GLM_API_KEY` — required to enable/select GLM. Sent as `Authorization: Bearer`.
  - `GLM_MODEL` — default `glm-4.7`. **Must name a model GA and entitled on the user's
    z.ai plan** (the default is a current id as of 2026-06; verify against the plan).
  - `GLM_BASE_URL` — default `https://api.z.ai/api/anthropic`, z.ai's
    Anthropic-compatible base URL (consumed by the Anthropic SDK). The default also serves
    GLM Coding Plan keys — the plan is selected by the API key, not by a different Anthropic
    URL. **Do not** set this to `https://api.z.ai/api/coding/paas/v4`: that is z.ai's
    OpenAI-compatible surface (Chat Completions) and is incompatible with the Anthropic SDK.
    (An earlier draft wrongly listed the coding URL as an alternate base — corrected
    2026-06-30 per CodeRabbit review of PR #11.)

## Data flow (switching)

1. User opens **Settings**, picks **GLM**, clicks **Save**.
2. `POST /api/settings` validates `GLM_API_KEY` is present → `setSetting("active_provider","glm")`.
3. Next generation/tutor call → `getLlm()` reads `active_provider = "glm"` →
   `resolveActiveProviderId` → `"glm"` → cached `GlmProvider` → z.ai.
4. Switching back to **Claude** is symmetric; resolves to the API or CLI provider exactly
   as today.

## Error handling & edge cases

- **GLM selected, key missing:** the POST is rejected (400), so this normally can't be
  saved. Defense in depth: if the DB somehow holds `"glm"` with no key (e.g. key removed
  after selection), `GlmProvider`'s constructor throws a clear "GLM_API_KEY is not set"
  error surfaced by the calling route the same way other generation errors are.
- **Unknown / corrupt setting value:** `getActiveProvider()` falls back to `"claude"`.
- **z.ai auth/network errors:** propagate through the existing provider error paths (the
  Anthropic SDK throws; callers already handle generation errors).
- **Mid-flight switch:** the in-flight job keeps its provider; the next queued job uses
  the new one. Acceptable given the serial queue.

## Testing (vitest, `lib/` only)

- `resolveActiveProviderId` — all `selected × ANTHROPIC_API_KEY` combinations
  (`claude`+key → `claude-api`; `claude`+no key → `claude-cli`; `glm`+key → `glm`;
  `glm`+no key → `glm`, with the constructor guard tested separately).
- `getSetting` / `setSetting` / `getActiveProvider` — round-trip and default behavior
  against a temp `DATA_DIR`.
- `getLlm()` with a stub selector — asserts `"glm" → GlmProvider` etc. without a DB
  (enabled by the injected selector; see Layer boundary above).
- Provider network calls remain manually verified (consistent with the currently untested
  `anthropic.ts`). Component/route behavior verified by `tsc --noEmit`, `next build`, and
  manual run, per the project's test conventions.

**Mandatory GLM integration smoke test (definition of done).** Before this is considered
complete, run one real streamed tutor call with `active_provider = "glm"` against z.ai and
assert the stream yields **non-empty** text. Rationale: `stream()` filters strictly for
`content_block_delta` / `text_delta`; if z.ai's SSE schema deviates, streaming silently
yields nothing with no error. This must be empirically confirmed, not assumed. A one-shot
`generate()` call against z.ai is a secondary check (validates auth + model id + base URL
end to end).

## Out of scope (YAGNI)

- Entering / storing API keys in the browser or DB.
- Per-book or per-feature model selection.
- A free-form model-id picker in the UI (model ids stay env-configurable).
- Multi-turn conversation changes or any tutor-history schema change.

## Files touched

| File | Change |
|------|--------|
| `lib/llm/anthropic-compatible.ts` | **new** — shared base with `generate`/`stream` |
| `lib/llm/anthropic.ts` | slim to a subclass of the base |
| `lib/llm/glm.ts` | **new** — `GlmProvider` (z.ai via Anthropic SDK) |
| `lib/llm/resolve.ts` | **new** — pure `resolveActiveProviderId` |
| `lib/llm/index.ts` | dynamic `getLlm()` reading the DB setting, per-id memo cache |
| `lib/db.ts` | `settings` table + `getSetting`/`setSetting`/`getActiveProvider` |
| `app/api/settings/route.ts` | **new** — GET/POST settings |
| `app/settings/page.tsx` | **new** — settings page (server) |
| `components/settings.tsx` | **new** — settings form (client) |
| `components/library.tsx` | add a Settings link in the header |
| `app/api/health/route.ts` | report resolved active provider |
| `README.md` | document `GLM_API_KEY` / `GLM_MODEL` / `GLM_BASE_URL` |
| `tests/…` | `resolve` + settings-store unit tests |
