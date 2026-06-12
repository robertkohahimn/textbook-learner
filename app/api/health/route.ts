import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    llm: process.env.ANTHROPIC_API_KEY ? "anthropic-api" : "claude-cli",
  });
}
