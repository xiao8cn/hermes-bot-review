import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { HERMES_SESSIONS_DIR, getHermesProfileHome } from "@/lib/hermes-paths";

export interface GlobalSessionIndexEntry {
  key: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  platform?: string;
  chatType?: string;
  displayName?: string | null;
  systemSent?: boolean;
  origin?: any;
}

export interface GlobalDayStat {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  messageCount: number;
  avgResponseMs: number;
  responseTimes: number[];
}

export interface GlobalAgentSessionSummary {
  lastActive: number | null;
  totalTokens: number;
  contextTokens: number;
  sessionCount: number;
  todayAvgResponseMs: number;
  messageCount: number;
  weeklyResponseMs: number[];
  weeklyTokens: number[];
  daily: GlobalDayStat[];
}

export interface GlobalSessionListItem {
  key: string;
  type: string;
  target: string;
  sessionId: string | null;
  updatedAt: number;
  totalTokens: number;
  contextTokens: number;
  systemSent: boolean;
  chatName: string | null;
  platform: string | null;
}

function toNumber(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeTimestampMs(value: any): number {
  const numeric = toNumber(value);
  if (numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function toTimestamp(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseSessionIndexEntry(key: string, val: any): GlobalSessionIndexEntry {
  const sessionId = String(val?.session_id || val?.sessionId || key.split(":").pop() || "");
  const updatedAt = normalizeTimestampMs(val?.updated_at || val?.updatedAt || 0);
  const createdAt = normalizeTimestampMs(val?.created_at || val?.createdAt || updatedAt);
  const inputTokens = toNumber(val?.input_tokens || val?.inputTokens || 0);
  const outputTokens = toNumber(val?.output_tokens || val?.outputTokens || 0);
  const totalTokensRaw = toNumber(val?.total_tokens || val?.totalTokens || 0);
  const totalTokens = totalTokensRaw || inputTokens + outputTokens;
  const contextTokens = toNumber(val?.context_tokens || val?.contextTokens || val?.last_prompt_tokens || val?.lastPromptTokens || inputTokens);

  return {
    key,
    sessionId,
    createdAt,
    updatedAt,
    inputTokens,
    outputTokens,
    totalTokens,
    contextTokens,
    platform: typeof val?.platform === "string" ? val.platform : undefined,
    chatType: typeof val?.chat_type === "string" ? val.chat_type : typeof val?.chatType === "string" ? val.chatType : undefined,
    displayName: typeof val?.display_name === "string" ? val.display_name : null,
    systemSent: !!(val?.systemSent || val?.system_sent),
    origin: val?.origin,
  };
}

export function readGlobalSessionIndex(): GlobalSessionIndexEntry[] {
  const sessionsPath = path.join(HERMES_SESSIONS_DIR, "sessions.json");
  try {
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([key, val]) => ({ key, ...(val as any) }));
    return entries.map((entry: any) => parseSessionIndexEntry(entry.key || entry.session_key || entry.sessionKey, entry));
  } catch {
    return [];
  }
}

export function getGlobalAgentSessions(agentId: string): GlobalSessionListItem[] {
  return readGlobalSessionIndex()
    .filter((entry) => entry.key.startsWith(`agent:${agentId}:`))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((entry) => {
      let type = "unknown";
      let target = "";
      if (entry.key.endsWith(":main")) {
        type = "main";
      } else if (entry.key.includes(":feishu:direct:")) {
        type = "feishu-dm";
        target = entry.key.split(":feishu:direct:")[1];
      } else if (entry.key.includes(":feishu:group:")) {
        type = "feishu-group";
        target = entry.key.split(":feishu:group:")[1];
      } else if (entry.key.includes(":discord:direct:")) {
        type = "discord-dm";
        target = entry.key.split(":discord:direct:")[1];
      } else if (entry.key.includes(":discord:channel:")) {
        type = "discord-channel";
        target = entry.key.split(":discord:channel:")[1];
      } else if (entry.key.includes(":telegram:direct:")) {
        type = "telegram-dm";
        target = entry.key.split(":telegram:direct:")[1];
      } else if (entry.key.includes(":telegram:group:")) {
        type = "telegram-group";
        target = entry.key.split(":telegram:group:")[1];
      } else if (entry.key.includes(":whatsapp:direct:")) {
        type = "whatsapp-dm";
        target = entry.key.split(":whatsapp:direct:")[1];
      } else if (entry.key.includes(":whatsapp:group:")) {
        type = "whatsapp-group";
        target = entry.key.split(":whatsapp:group:")[1];
      } else if (entry.key.includes(":cron:")) {
        type = "cron";
        target = entry.key.split(":cron:")[1];
      }

      return {
        key: entry.key,
        type,
        target,
        sessionId: entry.sessionId || null,
        updatedAt: entry.updatedAt || 0,
        totalTokens: entry.totalTokens || 0,
        contextTokens: entry.contextTokens || 0,
        systemSent: !!entry.systemSent,
        chatName: entry.displayName || null,
        platform: entry.platform || null,
      };
    });
}

function readSessionJsonl(sessionId: string): string[] {
  const sessionPath = path.join(HERMES_SESSIONS_DIR, `${sessionId}.jsonl`);
  try {
    return fs.readFileSync(sessionPath, "utf-8").split("\n");
  } catch {
    return [];
  }
}

interface StateDbDailyRow {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  messageCount: number;
}

interface StateDbSnapshot {
  lastActive: number;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalMessageCount: number;
  daily: StateDbDailyRow[];
  responseTimesByDay: Record<string, number[]>;
}

const PY_STATE_DB_SCRIPT = String.raw`
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

def _to_num(v):
    try:
        return float(v)
    except Exception:
        return 0.0

db_path = sys.argv[1]
if not db_path or not os.path.exists(db_path):
    print(json.dumps({
        "ok": False,
        "error": "state.db not found",
        "last_active": 0,
        "session_count": 0,
        "totals": {},
        "daily": [],
        "response_times_by_day": {}
    }))
    sys.exit(0)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
try:
    totals_row = conn.execute("""
        SELECT
          COALESCE(MAX(COALESCE(ended_at, started_at)), 0) AS last_active,
          COUNT(*) AS session_count,
          COALESCE(SUM(input_tokens), 0) AS total_input,
          COALESCE(SUM(output_tokens), 0) AS total_output,
          COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
          COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write,
          COALESCE(SUM(reasoning_tokens), 0) AS total_reasoning,
          COALESCE(SUM(message_count), 0) AS total_messages
        FROM sessions
    """).fetchone()

    daily_rows = conn.execute("""
        SELECT
          date(started_at, 'unixepoch') AS day,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(SUM(message_count), 0) AS message_count
        FROM sessions
        GROUP BY day
        ORDER BY day
    """).fetchall()

    response_rows = conn.execute("""
        SELECT session_id, role, timestamp
        FROM messages
        WHERE role IN ('user', 'assistant')
        ORDER BY session_id, timestamp
    """).fetchall()

    pending_user_ts = {}
    response_times_by_day = {}
    for row in response_rows:
        sid = str(row["session_id"] or "")
        role = str(row["role"] or "")
        ts = _to_num(row["timestamp"])
        if not sid or not role or ts <= 0:
            continue

        if role == "user":
            pending_user_ts[sid] = ts
            continue

        if role == "assistant":
            user_ts = pending_user_ts.get(sid)
            if user_ts and ts > user_ts:
                diff_ms = int(round((ts - user_ts) * 1000.0))
                if 0 < diff_ms < 600000:
                    day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
                    response_times_by_day.setdefault(day, []).append(diff_ms)
            pending_user_ts[sid] = None

    payload = {
        "ok": True,
        "last_active": _to_num(totals_row["last_active"]),
        "session_count": int(totals_row["session_count"] or 0),
        "totals": {
            "input": int(totals_row["total_input"] or 0),
            "output": int(totals_row["total_output"] or 0),
            "cache_read": int(totals_row["total_cache_read"] or 0),
            "cache_write": int(totals_row["total_cache_write"] or 0),
            "reasoning": int(totals_row["total_reasoning"] or 0),
            "messages": int(totals_row["total_messages"] or 0),
        },
        "daily": [
            {
                "date": str(r["day"] or ""),
                "input_tokens": int(r["input_tokens"] or 0),
                "output_tokens": int(r["output_tokens"] or 0),
                "cache_read_tokens": int(r["cache_read_tokens"] or 0),
                "cache_write_tokens": int(r["cache_write_tokens"] or 0),
                "message_count": int(r["message_count"] or 0),
            }
            for r in daily_rows
            if r["day"]
        ],
        "response_times_by_day": response_times_by_day,
    }
    print(json.dumps(payload))
finally:
    conn.close()
`;

function readStateDbSnapshot(agentId: string): StateDbSnapshot {
  const profileHome = getHermesProfileHome(agentId);
  const stateDbPath = path.join(profileHome, "state.db");

  if (!fs.existsSync(stateDbPath)) {
    return {
      lastActive: 0,
      sessionCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalReasoningTokens: 0,
      totalMessageCount: 0,
      daily: [],
      responseTimesByDay: {},
    };
  }

  try {
    const stdout = execFileSync("python3", ["-c", PY_STATE_DB_SCRIPT, stateDbPath], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || "{}");
    const totals = parsed?.totals || {};
    const dailyRows = Array.isArray(parsed?.daily) ? parsed.daily : [];
    const responseTimesByDay: Record<string, number[]> = {};
    const rawResponseTimes = parsed?.response_times_by_day;
    if (rawResponseTimes && typeof rawResponseTimes === "object") {
      for (const [day, values] of Object.entries(rawResponseTimes)) {
        if (!Array.isArray(values)) continue;
        responseTimesByDay[day] = values
          .map((value) => toNumber(value))
          .filter((value) => value > 0);
      }
    }

    return {
      lastActive: normalizeTimestampMs(parsed?.last_active),
      sessionCount: toNumber(parsed?.session_count),
      totalInputTokens: toNumber(totals.input),
      totalOutputTokens: toNumber(totals.output),
      totalCacheReadTokens: toNumber(totals.cache_read),
      totalCacheWriteTokens: toNumber(totals.cache_write),
      totalReasoningTokens: toNumber(totals.reasoning),
      totalMessageCount: toNumber(totals.messages),
      daily: dailyRows.map((row: any) => {
        const inputTokens = toNumber(row?.input_tokens);
        const outputTokens = toNumber(row?.output_tokens);
        const cacheReadTokens = toNumber(row?.cache_read_tokens);
        const cacheWriteTokens = toNumber(row?.cache_write_tokens);
        return {
          date: String(row?.date || ""),
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          contextTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
          messageCount: toNumber(row?.message_count),
        };
      }).filter((row: { date: string }) => !!row.date),
      responseTimesByDay,
    };
  } catch {
    return {
      lastActive: 0,
      sessionCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalReasoningTokens: 0,
      totalMessageCount: 0,
      daily: [],
      responseTimesByDay: {},
    };
  }
}

export function getGlobalAgentSessionSummary(agentId: string): GlobalAgentSessionSummary {
  const snapshot = readStateDbSnapshot(agentId);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const weekDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const dayMap: Record<string, GlobalDayStat> = {};
  for (const date of weekDates) {
    dayMap[date] = { date, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0, responseTimes: [] };
  }

  for (const day of snapshot.daily) {
    if (!dayMap[day.date]) {
      dayMap[day.date] = { date: day.date, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0, responseTimes: [] };
    }
    dayMap[day.date].inputTokens += day.inputTokens;
    dayMap[day.date].outputTokens += day.outputTokens;
    dayMap[day.date].totalTokens += day.totalTokens;
    dayMap[day.date].messageCount += day.messageCount;
  }

  for (const [day, responseTimes] of Object.entries(snapshot.responseTimesByDay)) {
    if (!dayMap[day]) {
      dayMap[day] = { date: day, inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0, avgResponseMs: 0, responseTimes: [] };
    }
    dayMap[day].responseTimes.push(...responseTimes);
  }

  const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
    const avgResponseMs = day.responseTimes.length > 0
      ? Math.round(day.responseTimes.reduce((sum, value) => sum + value, 0) / day.responseTimes.length)
      : 0;
    return { ...day, avgResponseMs };
  });

  const todayTimes = daily.find((day) => day.date === today)?.responseTimes || [];
  const todayAvgResponseMs = todayTimes.length > 0
    ? Math.round(todayTimes.reduce((sum, value) => sum + value, 0) / todayTimes.length)
    : 0;

  const weeklyResponseMs = weekDates.map((date) => {
    const times = dayMap[date]?.responseTimes || [];
    if (times.length === 0) return 0;
    return Math.round(times.reduce((sum, value) => sum + value, 0) / times.length);
  });

  const weeklyTokens = weekDates.map((date) => dayMap[date]?.totalTokens || 0);

  return {
    lastActive: snapshot.lastActive || null,
    totalTokens: snapshot.totalInputTokens + snapshot.totalOutputTokens,
    contextTokens: snapshot.totalInputTokens + snapshot.totalCacheReadTokens + snapshot.totalCacheWriteTokens,
    sessionCount: snapshot.sessionCount,
    todayAvgResponseMs,
    messageCount: snapshot.totalMessageCount,
    weeklyResponseMs,
    weeklyTokens,
    daily,
  };
}
