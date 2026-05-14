import { NextResponse } from "next/server";
import { getGlobalAgentSessions } from "@/lib/hermes-global-sessions";

function isValidAgentId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    if (!isValidAgentId(agentId)) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }
    const list = getGlobalAgentSessions(agentId);

    // 按最近活跃排序
    list.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ agentId, sessions: list });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
