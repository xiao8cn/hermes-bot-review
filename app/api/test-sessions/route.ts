import { NextResponse } from "next/server";
import { listHermesProfiles } from "@/lib/hermes-paths";
import { getGlobalAgentSessionSummary } from "@/lib/hermes-global-sessions";

type SessionTestResult = {
  agentId: string;
  ok: boolean;
  elapsed: number;
  reply?: string;
  error?: string;
};

function getAgentIds(): string[] {
  const ids = listHermesProfiles();
  return ids.length > 0 ? ids : ["main"];
}

function runSessionTests(agentIds: string[]): SessionTestResult[] {
  const startedAt = Date.now();
  return agentIds.map((agentId) => {
    const summary = getGlobalAgentSessionSummary(agentId);
    const hasSessions = summary.sessionCount > 0;
    return {
      agentId,
      ok: hasSessions,
      elapsed: Date.now() - startedAt,
      reply: hasSessions ? `Found ${summary.sessionCount} sessions` : undefined,
      error: hasSessions ? undefined : "No sessions found for this agent",
    };
  });
}

function handleRequest() {
  try {
    const results = runSessionTests(getAgentIds());
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return handleRequest();
}

export async function POST() {
  return handleRequest();
}
