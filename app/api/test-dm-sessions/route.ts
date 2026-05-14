import { NextResponse } from "next/server";
import { listHermesProfiles } from "@/lib/hermes-paths";
import { readHermesConfig } from "@/lib/hermes-config";
import { shouldHidePlatformChannel } from "@/lib/platforms";
import { getGlobalAgentSessions } from "@/lib/hermes-global-sessions";

type DmSessionTestResult = {
  agentId: string;
  platform: string;
  ok: boolean;
  elapsed: number;
  detail?: string;
  error?: string;
};

function getEnabledPlatformNames(config: any): string[] {
  const channels = config?.gateway?.platforms || config?.channels || {};
  return Object.entries(channels)
    .filter(([name, cfg]) => cfg && typeof cfg === "object" && (cfg as any).enabled !== false && !shouldHidePlatformChannel(name, channels))
    .map(([name]) => name);
}

function inferDmType(platform: string): string {
  const map: Record<string, string> = {
    feishu: "feishu-dm",
    discord: "discord-dm",
    telegram: "telegram-dm",
    whatsapp: "whatsapp-dm",
  };
  return map[platform] || `${platform}-dm`;
}

function getAgentIds(): string[] {
  const ids = listHermesProfiles();
  return ids.length > 0 ? ids : ["main"];
}

function runDmSessionTests(config: any): DmSessionTestResult[] {
  const startedAt = Date.now();
  const platforms = getEnabledPlatformNames(config);
  const agentIds = getAgentIds();
  const results: DmSessionTestResult[] = [];

  for (const agentId of agentIds) {
    const sessions = getGlobalAgentSessions(agentId);
    for (const platform of platforms) {
      const dmType = inferDmType(platform);
      const matched = sessions.filter((s) => s.type === dmType);
      results.push({
        agentId,
        platform,
        ok: matched.length > 0,
        elapsed: Date.now() - startedAt,
        detail: matched.length > 0 ? `Found ${matched.length} DM sessions` : undefined,
        error: matched.length > 0 ? undefined : `No ${platform} DM sessions found`,
      });
    }
  }

  return results;
}

function handleRequest() {
  try {
    const config = readHermesConfig() || {};
    const results = runDmSessionTests(config);
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
