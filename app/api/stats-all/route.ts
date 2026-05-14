import { NextResponse } from "next/server";
import { listHermesProfiles } from "@/lib/hermes-paths";
import { getGlobalAgentSessionSummary, type GlobalDayStat } from "@/lib/hermes-global-sessions";

// 30秒内存缓存
let statsCache: { data: any; ts: number } | null = null;
const CACHE_TTL_MS = 30_000;

type DayStat = Omit<GlobalDayStat, "responseTimes">;

interface InternalDayStat extends GlobalDayStat {
  responseTimes: number[];
}

function aggregateToWeeklyMonthly(daily: DayStat[]) {
  const weekMap: Record<string, DayStat> = {};
  const monthMap: Record<string, DayStat> = {};

  for (const d of daily) {
    const dt = new Date(d.date + "T00:00:00Z");
    const day = dt.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(dt.getTime() + mondayOffset * 86400000);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!weekMap[weekKey]) weekMap[weekKey] = { date: weekKey, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0 };
    weekMap[weekKey].inputTokens += d.inputTokens;
    weekMap[weekKey].outputTokens += d.outputTokens;
    weekMap[weekKey].totalTokens += d.totalTokens;
    weekMap[weekKey].messageCount += d.messageCount;

    const monthKey = d.date.slice(0, 7);
    if (!monthMap[monthKey]) monthMap[monthKey] = { date: monthKey, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0 };
    monthMap[monthKey].inputTokens += d.inputTokens;
    monthMap[monthKey].outputTokens += d.outputTokens;
    monthMap[monthKey].totalTokens += d.totalTokens;
    monthMap[monthKey].messageCount += d.messageCount;
  }

  return {
    weekly: Object.values(weekMap).sort((a, b) => a.date.localeCompare(b.date)),
    monthly: Object.values(monthMap).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function GET() {
  // 命中缓存直接返回
  if (statsCache && Date.now() - statsCache.ts < CACHE_TTL_MS) {
    return NextResponse.json(statsCache.data);
  }

  try {
    const agentIds = listHermesProfiles();

    // 并行处理所有 agent
    const allAgentDays = agentIds.map((id) => getGlobalAgentSessionSummary(id).daily);

    const dayMap: Record<string, InternalDayStat> = {};
    for (const agentDays of allAgentDays) {
      for (const ad of agentDays) {
        if (!dayMap[ad.date]) {
          dayMap[ad.date] = { date: ad.date, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0, responseTimes: [] };
        }
        const d = dayMap[ad.date];
        d.inputTokens += ad.inputTokens;
        d.outputTokens += ad.outputTokens;
        d.totalTokens += ad.totalTokens;
        d.messageCount += ad.messageCount;
        d.responseTimes.push(...ad.responseTimes);
      }
    }

    const daily: DayStat[] = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ responseTimes, ...rest }) => {
        if (responseTimes.length > 0) {
          rest.avgResponseMs = Math.round(responseTimes.reduce((sum: number, value: number) => sum + value, 0) / responseTimes.length);
        }
        return rest;
      });

    const { weekly, monthly } = aggregateToWeeklyMonthly(daily);

    const data = { daily, weekly, monthly };
    statsCache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
