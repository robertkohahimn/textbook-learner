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
