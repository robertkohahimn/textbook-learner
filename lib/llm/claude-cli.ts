import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { LlmOptions, LlmProvider } from "./types";

const TIMEOUT_MS = 5 * 60 * 1000;

export interface StreamLineEvent {
  text?: string;
  result?: string;
  isError?: boolean;
}

/** Parse one JSONL line of `claude -p --output-format stream-json` output. */
export function parseStreamLine(line: string): StreamLineEvent {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return {};
  }
  if (event.type === "stream_event") {
    const inner = event.event as
      | { type?: string; delta?: { type?: string; text?: string } }
      | undefined;
    if (
      inner?.type === "content_block_delta" &&
      inner.delta?.type === "text_delta" &&
      typeof inner.delta.text === "string"
    ) {
      return { text: inner.delta.text };
    }
    return {};
  }
  if (event.type === "result") {
    return {
      result: typeof event.result === "string" ? event.result : "",
      isError: Boolean(event.is_error),
    };
  }
  return {};
}

function cliEnv(): NodeJS.ProcessEnv {
  // Drop the nested-session marker so the CLI behaves like a fresh headless run.
  const { CLAUDECODE: _ignored, ...env } = process.env;
  return env;
}

function workDir(): string {
  // Neutral cwd so the CLI doesn't pick up this project's CLAUDE.md or skills.
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function model(): string {
  return process.env.LLM_MODEL ?? "sonnet";
}

function run(
  args: string[],
  prompt: string,
  onLine: (line: string) => void
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: workDir(),
      env: cliEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out"));
    }, TIMEOUT_MS);

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    const rl = createInterface({ input: child.stdout });
    rl.on("line", onLine);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        err.message.includes("ENOENT")
          ? new Error(
              "claude CLI not found. Install Claude Code or set ANTHROPIC_API_KEY."
            )
          : err
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export class ClaudeCliProvider implements LlmProvider {
  async generate(prompt: string, opts?: LlmOptions): Promise<string> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      model(),
      ...(opts?.system ? ["--append-system-prompt", opts.system] : []),
    ];
    let output = "";
    const { code, stderr } = await run(args, prompt, (line) => (output += line));
    if (code !== 0) {
      throw new Error(`claude CLI exited with ${code}: ${stderr.slice(-500)}`);
    }
    const parsed = JSON.parse(output) as { is_error?: boolean; result?: string };
    if (parsed.is_error) {
      throw new Error(`claude CLI error: ${parsed.result ?? "unknown"}`);
    }
    if (typeof parsed.result !== "string") {
      throw new Error("claude CLI returned no result");
    }
    return parsed.result;
  }

  async *stream(prompt: string, opts?: LlmOptions): AsyncIterable<string> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--model",
      model(),
      ...(opts?.system ? ["--append-system-prompt", opts.system] : []),
    ];

    const chunks: string[] = [];
    let finalResult: string | undefined;
    let errored: string | undefined;
    let sawPartial = false;

    let notify: (() => void) | undefined;
    const wake = () => notify?.();
    let done = false;

    const finished = run(args, prompt, (line) => {
      const ev = parseStreamLine(line);
      if (ev.text !== undefined) {
        sawPartial = true;
        chunks.push(ev.text);
        wake();
      } else if (ev.result !== undefined) {
        if (ev.isError) errored = ev.result || "unknown CLI error";
        else finalResult = ev.result;
      }
    })
      .then(({ code, stderr }) => {
        if (code !== 0 && !finalResult) {
          errored = errored ?? `claude CLI exited with ${code}: ${stderr.slice(-500)}`;
        }
      })
      .catch((err: Error) => {
        errored = err.message;
      })
      .finally(() => {
        done = true;
        wake();
      });

    let emitted = 0;
    while (!done || emitted < chunks.length) {
      if (emitted < chunks.length) {
        yield chunks[emitted++];
        continue;
      }
      await new Promise<void>((res) => {
        notify = res;
      });
      notify = undefined;
    }
    await finished;

    if (errored) throw new Error(errored);
    // Older CLIs may not emit partial deltas; fall back to the final result.
    if (!sawPartial && finalResult) yield finalResult;
  }
}
