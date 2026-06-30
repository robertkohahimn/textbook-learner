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
