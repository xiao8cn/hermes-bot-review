import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfigCache, setConfigCache } from "@/lib/config-cache";
import { readHermesConfig } from "@/lib/hermes-config";
import {
  HERMES_HOME,
  listHermesProfiles,
  getHermesProfileHome,
  getHermesProfileSessionsDir,
} from "@/lib/hermes-paths";
import { getGlobalAgentSessionSummary, getGlobalAgentSessions } from "@/lib/hermes-global-sessions";
import { shouldHidePlatformChannel } from "@/lib/platforms";

const CACHE_TTL_MS = 30_000;


// 读取 agent 的 session 状态（最近活跃时间、token 用量）- 从 jsonl 文件解析
interface SessionStatus {
  lastActive: number | null;
  totalTokens: number;
  contextTokens: number;
  sessionCount: number;
  todayAvgResponseMs: number;
  messageCount: number;
  weeklyResponseMs: number[]; // 过去7天每天的平均响应时间
  weeklyTokens: number[]; // 过去7天每天的token用量
}

function getAgentSessionStatus(agentId: string): SessionStatus {
  const summary = getGlobalAgentSessionSummary(agentId);
  return {
    lastActive: summary.lastActive,
    totalTokens: summary.totalTokens,
    contextTokens: summary.contextTokens,
    sessionCount: summary.sessionCount,
    todayAvgResponseMs: summary.todayAvgResponseMs,
    messageCount: summary.messageCount,
    weeklyResponseMs: summary.weeklyResponseMs,
    weeklyTokens: summary.weeklyTokens,
  };
}

// 读取所有 agent 的群聊信息
interface GroupChat {
  groupId: string;
  agents: { id: string; emoji: string; name: string }[];
  channel: string;
}

function getGroupChats(agentIds: string[], agentMap: Record<string, { emoji: string; name: string }>, sessionsMap: Map<string, any>): GroupChat[] {
  const groupAgents: Record<string, { agents: Set<string>; channel: string }> = {};
  for (const agentId of agentIds) {
    try {
      const sessions = sessionsMap.get(agentId);
      if (!sessions) continue;
      for (const key of Object.keys(sessions)) {
        // 匹配群聊 session: agent:{id}:feishu:group:{groupId} 或 agent:{id}:discord:channel:{channelId}
        const feishuGroup = key.match(/^agent:[^:]+:feishu:group:(.+)$/);
        const discordGroup = key.match(/^agent:[^:]+:discord:channel:(.+)$/);
        const telegramGroup = key.match(/^agent:[^:]+:telegram:group:(.+)$/);
        const whatsappGroup = key.match(/^agent:[^:]+:whatsapp:group:(.+)$/);
        if (feishuGroup) {
          const gid = `feishu:${feishuGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "feishu" };
          groupAgents[gid].agents.add(agentId);
        }
        if (discordGroup) {
          const gid = `discord:${discordGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "discord" };
          groupAgents[gid].agents.add(agentId);
        }
        if (telegramGroup) {
          const gid = `telegram:${telegramGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "telegram" };
          groupAgents[gid].agents.add(agentId);
        }
        if (whatsappGroup) {
          const gid = `whatsapp:${whatsappGroup[1]}`;
          if (!groupAgents[gid]) groupAgents[gid] = { agents: new Set(), channel: "whatsapp" };
          groupAgents[gid].agents.add(agentId);
        }
      }
    } catch {}
  }
  // 返回每个群聊实际有 session 的 agents
  return Object.entries(groupAgents)
    .filter(([, v]) => v.agents.size > 0)
    .map(([groupId, v]) => ({
      groupId,
      channel: v.channel,
      agents: Array.from(v.agents).map(id => ({ id, emoji: agentMap[id]?.emoji || "🤖", name: agentMap[id]?.name || id })),
    }));
}

// 从 Hermes sessions 文件获取每个 agent 最近活跃的飞书 DM session 的用户 open_id
function getFeishuUserOpenIds(agentIds: string[], sessionsMap: Map<string, any>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agentId of agentIds) {
    try {
      const sessions = sessionsMap.get(agentId);
      if (!sessions) continue;
      let best: { openId: string; updatedAt: number } | null = null;
      for (const [key, val] of Object.entries(sessions)) {
        const m = key.match(/^agent:[^:]+:feishu:direct:(ou_[a-f0-9]+)$/);
        if (m) {
          const updatedAt = (val as any).updatedAt || 0;
          if (!best || updatedAt > best.updatedAt) {
            best = { openId: m[1], updatedAt };
          }
        }
      }
      if (best) map[agentId] = best.openId;
    } catch {}
  }
  return map;
}

function getChannelDirectPeerIds(
  agentIds: string[],
  sessionsMap: Map<string, any>,
  channel: string
): Record<string, string> {
  const map: Record<string, string> = {};
  const pattern = new RegExp(`^agent:[^:]+:${channel}:direct:(.+)$`);
  for (const agentId of agentIds) {
    try {
      const sessions = sessionsMap.get(agentId);
      if (!sessions) continue;
      let best: { peerId: string; updatedAt: number } | null = null;
      for (const [key, val] of Object.entries(sessions)) {
        const m = key.match(pattern);
        if (m) {
          const updatedAt = (val as any).updatedAt || 0;
          if (!best || updatedAt > best.updatedAt) {
            best = { peerId: m[1], updatedAt };
          }
        }
      }
      if (best) map[agentId] = best.peerId;
    } catch {}
  }
  return map;
}
// 从 SOUL.md 读取 Hermes agent 名字
function readSoulName(profileId: string): string | null {
  const profileHome = getHermesProfileHome(profileId);
  const candidates = [
    path.join(profileHome, "SOUL.md"),
    path.join(profileHome, "agent", "SOUL.md"),
    path.join(HERMES_HOME, "SOUL.md"),
  ];
  for (const p of candidates) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      const match =
        content.match(/\*\*Name:\*\*\s*(.+)/) ||
        content.match(/^name:\s*(.+)/m);
      if (match) {
        const name = match[1].trim().replace(/^["']|["']$/g, "");
        if (name && !name.startsWith("_") && !name.startsWith("(")) return name;
      }
    } catch {}
  }
  return null;
}

export async function GET() {
  // 命中缓存直接返回
  const configCache = getConfigCache();
  if (configCache && Date.now() - configCache.ts < CACHE_TTL_MS) {
    return NextResponse.json(configCache.data);
  }

  try {
    const config = readHermesConfig();
    if (!config) {
      return NextResponse.json({ error: "Hermes config not found" }, { status: 500 });
    }

    // Hermes model config: top-level `model` field
    const rawModel = config.model;
    const defaultModel =
      typeof rawModel === "string"
        ? rawModel
        : rawModel?.primary || rawModel?.default || "unknown";
    const fallbacks =
      typeof rawModel === "object" && rawModel !== null
        ? rawModel.fallbacks || []
        : [];

    const composeModelRef = (modelValue: any, providerValue: any): string | null => {
      const model = typeof modelValue === "string" ? modelValue.trim() : "";
      const provider = typeof providerValue === "string" ? providerValue.trim() : "";
      if (!model) return null;
      if (model.includes("/")) return model;
      if (!provider) return model;
      return `${provider}/${model}`;
    };

    const normalizeModelRef = (value: any, fallback: string): string => {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const primary = value.primary || value.default;
        const combined = composeModelRef(primary, value.provider);
        if (combined) return combined;
      }
      return fallback || "unknown";
    };

    const modelConfig = {
      provider: typeof rawModel?.provider === "string" ? rawModel.provider.trim() : "",
      default: typeof rawModel?.default === "string" ? rawModel.default.trim() : (typeof defaultModel === "string" ? defaultModel : ""),
      baseUrl: typeof rawModel?.base_url === "string" ? rawModel.base_url.trim() : "",
    };

    // Enumerate Hermes profiles as agents
    const profileIds = listHermesProfiles();

    // Read sessions.json for each profile
    const sessionsMap = new Map<string, any>();
    for (const profileId of profileIds) {
      try {
        const sessionsPath = path.join(
          getHermesProfileSessionsDir(profileId),
          "sessions.json"
        );
        const raw = fs.readFileSync(sessionsPath, "utf-8");
        sessionsMap.set(profileId, JSON.parse(raw));
      } catch {}
    }

    const feishuUserOpenIds = getFeishuUserOpenIds(profileIds, sessionsMap);

    // Hermes gateway.platforms config (also support legacy config.channels shape)
    const channels = config.gateway?.platforms || config.channels || {};

    const enabledChannelNames: string[] = Object.entries(channels)
      .filter(
        ([channelName, cfg]) =>
          cfg &&
          typeof cfg === "object" &&
          (cfg as any).enabled !== false &&
          !shouldHidePlatformChannel(channelName, channels)
      )
      .map(([channelName]) => channelName);

    const discoverChannelNames = enabledChannelNames;
    const directPeerIdsByChannel: Record<string, Record<string, string>> = {};
    for (const channelName of discoverChannelNames) {
      if (channelName === "feishu") continue;
      directPeerIdsByChannel[channelName] = getChannelDirectPeerIds(
        profileIds,
        sessionsMap,
        channelName
      );
    }

    const feishuAccounts = channels.feishu?.accounts || {};
    const discordDmAllowFrom = channels.discord?.dm?.allowFrom || [];

    // Build agent details from profiles
    const agents = await Promise.all(
      profileIds.map(async (profileId) => {
        const soulName = readSoulName(profileId);
        const name = soulName || profileId;
        const emoji = "🤖";

        // Model: try profile-specific config.yaml first, fall back to top-level
        let model = defaultModel;
        if (profileId !== "main") {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const jsYaml = require("js-yaml");
            const profileConfigPath = path.join(getHermesProfileHome(profileId), "config.yaml");
            const raw = fs.readFileSync(profileConfigPath, "utf-8");
            const profileCfg = jsYaml.load(raw) || {};
            model = normalizeModelRef(profileCfg.model, defaultModel);
          } catch {
            model = defaultModel;
          }
        } else {
          model = normalizeModelRef(rawModel, defaultModel);
        }

        const agentPlatforms: {
          name: string;
          accountId?: string;
          appId?: string;
          botOpenId?: string;
          botUserId?: string;
        }[] = [];
        const addPlatform = (platform: {
          name: string;
          accountId?: string;
          appId?: string;
          botOpenId?: string;
          botUserId?: string;
        }) => {
          if (!platform?.name) return;
          const exists = agentPlatforms.some(
            (p) =>
              p.name === platform.name &&
              (p.accountId || "") === (platform.accountId || "")
          );
          if (!exists) agentPlatforms.push(platform);
        };

        // Feishu binding
        const feishuCfg = channels.feishu;
        if (feishuCfg && feishuCfg.enabled !== false) {
          const acc = feishuAccounts[profileId] || feishuAccounts["main"];
          const appId = acc?.appId || feishuCfg?.appId;
          const userOpenId = feishuUserOpenIds[profileId] || null;
          addPlatform({
            name: "feishu",
            accountId: profileId,
            appId,
            ...(userOpenId && { botOpenId: userOpenId }),
          });
        }

        // Other enabled channels
        for (const channelName of discoverChannelNames) {
          if (channelName === "feishu") continue;
          const botUserId =
            directPeerIdsByChannel[channelName]?.[profileId] ||
            (channelName === "discord" ? discordDmAllowFrom[0] || null : null);
          addPlatform({ name: channelName, ...(botUserId && { botUserId }) });
        }

        return { id: profileId, name, emoji, model, platforms: agentPlatforms };
      })
    );

    const agentsWithStatus = agents.map((agent: any) => {
      const sessions = getGlobalAgentSessions(agent.id);
      return {
        ...agent,
        sessionKey:
          sessions.find((session) => session.key.endsWith(":main"))?.key ||
          sessions[0]?.key ||
          `agent:${agent.id}:main`,
        session: getAgentSessionStatus(agent.id),
      };
    });

    const agentMap: Record<string, { emoji: string; name: string }> = {};
    for (const a of agentsWithStatus) agentMap[a.id] = { emoji: a.emoji, name: a.name };

    const groupChats = getGroupChats(profileIds, agentMap, sessionsMap);

    const authProviderIds = new Set<string>();
    if (config.auth?.profiles) {
      for (const profileKey of Object.keys(config.auth.profiles)) {
        const profile = config.auth.profiles[profileKey];
        const providerId = profile?.provider || profileKey.split(":")[0];
        if (providerId) authProviderIds.add(providerId);
      }
    }

    let providers = Object.entries(config.models?.providers || {}).map(
      ([providerId, provider]: [string, any]) => {
        const models = (provider.models || []).map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
          input: m.input,
        }));
        const usedBy = agentsWithStatus
          .filter(
            (a: any) =>
              typeof a.model === "string" && a.model.startsWith(providerId + "/")
          )
          .map((a: any) => ({ id: a.id, emoji: a.emoji, name: a.name }));
        return {
          id: providerId,
          api: provider.api,
          accessMode: authProviderIds.has(providerId) ? "auth" : "api_key",
          models,
          usedBy,
        };
      }
    );

    const providerModels: Record<string, { id: string; name?: string }[]> = {};
    const ensureProvider = (providerId: string) => {
      if (providerId && !providerModels[providerId]) providerModels[providerId] = [];
    };
    const addModelRef = (modelKey?: string, alias?: string) => {
      if (!modelKey || typeof modelKey !== "string") return;
      const slashIdx = modelKey.indexOf("/");
      if (slashIdx <= 0 || slashIdx >= modelKey.length - 1) return;
      const providerId = modelKey.slice(0, slashIdx);
      const modelId = modelKey.slice(slashIdx + 1);
      ensureProvider(providerId);
      if (!providerModels[providerId].some((m) => m.id === modelId)) {
        providerModels[providerId].push({ id: modelId, ...(alias && { name: alias }) });
      }
    };

    for (const providerId of authProviderIds) ensureProvider(providerId);

    const defaultsModels = config.models?.defaults || {};
    for (const modelKey of Object.keys(defaultsModels)) {
      const alias = defaultsModels[modelKey]?.alias;
      addModelRef(modelKey, alias);
    }

    addModelRef(defaultModel);
    for (const fallback of fallbacks) addModelRef(fallback);
    for (const agent of agentsWithStatus) addModelRef(agent.model);

    for (const [providerId, inferredModels] of Object.entries(providerModels)) {
      let target = providers.find((p: any) => p.id === providerId);
      if (!target) {
        const usedBy = agentsWithStatus
          .filter(
            (a: any) =>
              typeof a.model === "string" && a.model.startsWith(providerId + "/")
          )
          .map((a: any) => ({ id: a.id, emoji: a.emoji, name: a.name }));
        target = {
          id: providerId,
          api: undefined,
          accessMode: authProviderIds.has(providerId) ? "auth" : "api_key",
          models: [],
          usedBy,
        };
        providers.push(target);
      }
      target.accessMode = authProviderIds.has(providerId)
        ? "auth"
        : target.accessMode || "api_key";
      for (const m of inferredModels) {
        const exists = target.models.find((x: any) => x.id === m.id);
        if (!exists) {
          target.models.push({
            id: m.id,
            name: m.name || m.id,
            contextWindow: undefined,
            maxTokens: undefined,
            reasoning: undefined,
            input: undefined,
          });
        } else if (!exists.name) {
          exists.name = m.name || exists.id;
        }
      }
    }

    if (modelConfig.provider) {
      let configuredProvider = providers.find((p: any) => p.id === modelConfig.provider);
      if (!configuredProvider) {
        const usedBy = agentsWithStatus
          .filter((a: any) => {
            if (typeof a.model !== "string") return false;
            if (a.model.startsWith(modelConfig.provider + "/")) return true;
            return a.model === modelConfig.default;
          })
          .map((a: any) => ({ id: a.id, emoji: a.emoji, name: a.name }));
        configuredProvider = {
          id: modelConfig.provider,
          api: modelConfig.baseUrl || undefined,
          accessMode: authProviderIds.has(modelConfig.provider) ? "auth" : "api_key",
          models: [],
          usedBy,
        };
        providers.push(configuredProvider);
      }

      if (modelConfig.baseUrl && !configuredProvider.api) {
        configuredProvider.api = modelConfig.baseUrl;
      }

      if (modelConfig.default) {
        const modelId = modelConfig.default.includes("/")
          ? modelConfig.default.split("/").slice(1).join("/")
          : modelConfig.default;
        if (modelId && !configuredProvider.models.some((m: any) => m.id === modelId)) {
          configuredProvider.models.push({
            id: modelId,
            name: modelId,
            contextWindow: undefined,
            maxTokens: undefined,
            reasoning: undefined,
            input: undefined,
          });
        }
      }
    }

    const data = {
      agents: agentsWithStatus,
      providers,
      defaults: { model: defaultModel, fallbacks },
      modelConfig,
      gateway: {
        port: config.gateway?.port || 18789,
        token: config.gateway?.auth?.token || "",
        host: config.gateway?.host || config.gateway?.hostname || "",
      },
      groupChats,
    };
    setConfigCache({ data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
