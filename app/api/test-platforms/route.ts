import { NextResponse } from "next/server";
import { readHermesConfig } from "@/lib/hermes-config";
import { listHermesProfiles } from "@/lib/hermes-paths";
import { shouldHidePlatformChannel } from "@/lib/platforms";

type PlatformTestResult = {
  agentId: string;
  platform: string;
  ok: boolean;
  elapsed: number;
  error?: string;
  source: "config_check";
};

function getEnabledChannels(config: any): Record<string, any> {
  const channels = config?.gateway?.platforms || config?.channels || {};
  const out: Record<string, any> = {};

  for (const [channelName, channelConfig] of Object.entries(channels)) {
    if (!channelConfig || typeof channelConfig !== "object") continue;
    if ((channelConfig as any).enabled === false) continue;
    if (shouldHidePlatformChannel(channelName, channels)) continue;
    out[channelName] = channelConfig;
  }

  return out;
}

function validatePlatformConfig(
  platform: string,
  platformConfig: any,
  channels: Record<string, any>,
  agentId: string
): { ok: boolean; error?: string } {
  if (!platformConfig || typeof platformConfig !== "object") {
    return { ok: false, error: "Platform config is missing" };
  }

  if (platform === "feishu") {
    const accounts = platformConfig.accounts || {};
    const account = accounts[agentId] || accounts.main || null;
    const appId = account?.appId || platformConfig.appId;
    if (!appId) {
      return { ok: false, error: "Feishu appId is missing" };
    }
  }

  if (platform === "discord") {
    const dmAllowFrom = channels?.discord?.dm?.allowFrom || [];
    if (Array.isArray(dmAllowFrom) && dmAllowFrom.length === 0) {
      return { ok: false, error: "Discord dm.allowFrom is empty" };
    }
  }

  return { ok: true };
}

function getAgentIds(): string[] {
  const ids = listHermesProfiles();
  return ids.length > 0 ? ids : ["main"];
}

function runPlatformChecks(config: any): PlatformTestResult[] {
  const startedAt = Date.now();
  const channels = getEnabledChannels(config);
  const platforms = Object.keys(channels);
  const agentIds = getAgentIds();

  if (platforms.length === 0) {
    return [];
  }

  const results: PlatformTestResult[] = [];
  for (const agentId of agentIds) {
    for (const platform of platforms) {
      const check = validatePlatformConfig(platform, channels[platform], channels, agentId);
      results.push({
        agentId,
        platform,
        ok: check.ok,
        error: check.error,
        elapsed: Date.now() - startedAt,
        source: "config_check",
      });
    }
  }

  return results;
}

function handleRequest() {
  try {
    const config = readHermesConfig() || {};
    const results = runPlatformChecks(config);
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return handleRequest();
}

export async function POST() {
  return handleRequest();
}
