import { NextResponse } from "next/server";
import { getGlobalAgentSessionSummary } from "@/lib/hermes-global-sessions";

interface DayStat {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  avgResponseMs: number;
}

function isValidAgentId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    if (!isValidAgentId(agentId)) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }
    const summary = getGlobalAgentSessionSummary(agentId);
    const daily: DayStat[] = summary.daily.map((d) => ({
      date: d.date,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      totalTokens: d.totalTokens,
      messageCount: d.messageCount,
      avgResponseMs: d.avgResponseMs,
    }));

    // Aggregate weekly and monthly
    const weekMap: Record<string, DayStat> = {};
    const monthMap: Record<string, DayStat> = {};

    for (const d of daily) {
      // Week: get Monday of that week
      const dt = new Date(d.date + "T00:00:00Z");
      const day = dt.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(dt.getTime() + mondayOffset * 86400000);
      const weekKey = monday.toISOString().slice(0, 10);

      if (!weekMap[weekKey]) {
        weekMap[weekKey] = { date: weekKey, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0 };
      }
      const w = weekMap[weekKey];
      w.inputTokens += d.inputTokens;
      w.outputTokens += d.outputTokens;
      w.totalTokens += d.totalTokens;
      w.messageCount += d.messageCount;

      // Month
      const monthKey = d.date.slice(0, 7);
      if (!monthMap[monthKey]) {
        monthMap[monthKey] = { date: monthKey, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0 };
      }
      const m = monthMap[monthKey];
      m.inputTokens += d.inputTokens;
      m.outputTokens += d.outputTokens;
      m.totalTokens += d.totalTokens;
      m.messageCount += d.messageCount;
    }

    return NextResponse.json({
      agentId,
      daily,
      weekly: Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date)),
      monthly: Object.values(monthMap).sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
