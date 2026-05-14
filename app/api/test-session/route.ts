import { NextResponse } from "next/server";
import { getGlobalAgentSessions } from "@/lib/hermes-global-sessions";

export async function POST(req: Request) {
  try {
    const { sessionKey, agentId } = await req.json();
    if (!sessionKey || !agentId) {
      return NextResponse.json({ status: "error", error: "Missing sessionKey or agentId" }, { status: 400 });
    }

    const startedAt = Date.now();
    const sessions = getGlobalAgentSessions(String(agentId));
    const found = sessions.find((s) => s.key === String(sessionKey));

    if (!found) {
      return NextResponse.json({
        status: "error",
        sessionKey,
        elapsed: Date.now() - startedAt,
        error: "Session not found in global Hermes session index",
      });
    }

    return NextResponse.json({
      status: "ok",
      sessionKey,
      elapsed: Date.now() - startedAt,
      reply: `Session is reachable (${found.type})`,
    });
  } catch (err: any) {
    return NextResponse.json({ status: "error", error: err?.message || "Internal server error" }, { status: 500 });
  }
}
