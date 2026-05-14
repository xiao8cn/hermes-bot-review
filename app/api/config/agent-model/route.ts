import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { clearConfigCache } from "@/lib/config-cache";
import { execHermes } from "@/lib/hermes-cli";
import { readHermesConfig } from "@/lib/hermes-config";
import {
  getHermesProfileHome,
  getHermesProfileSessionsDir,
  listHermesProfiles,
} from "@/lib/hermes-paths";

const SESSION_MODEL_FIELDS_TO_CLEAR = [
  "providerOverride",
  "modelOverride",
  "authProfileOverride",
  "authProfileOverrideSource",
  "authProfileOverrideCompactionCount",
  "fallbackNoticeSelectedModel",
  "fallbackNoticeActiveModel",
  "fallbackNoticeReason",
  "claudeCliSessionId",
  "modelProvider",
  "model",
] as const;

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "Unknown error";
}

function statusForError(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("config changed since last load")) return 409;
  if (lower.includes("missing") || lower.includes("invalid") || lower.includes("not found") || lower.includes("must")) return 400;
  if (
    lower.includes("gateway closed") ||
    lower.includes("timeout") ||
    lower.includes("econn") ||
    lower.includes("not running") ||
    lower.includes("abnormal closure")
  ) {
    return 503;
  }
  return 500;
}

function addModelRef(set: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("/")) return;
  set.add(trimmed);
}

function collectKnownModels(config: any): Set<string> {
  const models = new Set<string>();

  const providers = isPlainObject(config?.models?.providers) ? config.models.providers : {};
  for (const [providerId, provider] of Object.entries(providers)) {
    const providerModels = Array.isArray((provider as any)?.models) ? (provider as any).models : [];
    for (const model of providerModels) {
      addModelRef(models, `${providerId}/${model?.id ?? ""}`);
    }
  }

  const defaultsModel = config?.model;
  if (typeof defaultsModel === "string") {
    addModelRef(models, defaultsModel);
  } else if (isPlainObject(defaultsModel)) {
    addModelRef(models, defaultsModel.primary);
    addModelRef(models, defaultsModel.default);
    const fallbacks = Array.isArray(defaultsModel.fallbacks) ? defaultsModel.fallbacks : [];
    for (const fallback of fallbacks) addModelRef(models, fallback);
  }

  const defaultsModels = isPlainObject(config?.models?.defaults) ? config.models.defaults : {};
  for (const modelKey of Object.keys(defaultsModels)) {
    addModelRef(models, modelKey);
  }

  return models;
}

function extractCurrentModel(config: any): string | null {
  if (typeof config?.model === "string" && config.model.trim()) return config.model.trim();
  if (isPlainObject(config?.model)) {
    if (typeof config.model.primary === "string" && config.model.primary.trim()) {
      return config.model.primary.trim();
    }
    if (typeof config.model.default === "string" && config.model.default.trim()) {
      return config.model.default.trim();
    }
  }
  return null;
}

async function updateMainConfigModel(model: string): Promise<void> {
  await execHermes(["config", "set", "model", model]);
  await execHermes(["gateway", "restart"]);

  const reloaded = readHermesConfig() || {};
  if (extractCurrentModel(reloaded) !== model) {
    throw new Error(`Failed to persist main model: ${model}`);
  }
}

function clearAgentSessionModelState(agentId: string): void {
  const sessionsPath = path.join(getHermesProfileSessionsDir(agentId), "sessions.json");
  if (!fs.existsSync(sessionsPath)) return;

  const raw = fs.readFileSync(sessionsPath, "utf8");
  const sessions = JSON.parse(raw);
  if (!isPlainObject(sessions)) return;

  let changed = false;
  for (const value of Object.values(sessions)) {
    if (!isPlainObject(value)) continue;
    for (const field of SESSION_MODEL_FIELDS_TO_CLEAR) {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        delete value[field];
        changed = true;
      }
    }
  }

  if (!changed) return;

  const tmpPath = `${sessionsPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(sessions, null, 2), "utf8");
  fs.renameSync(tmpPath, sessionsPath);
}

function updateProfileConfigModel(agentId: string, model: string): void {
  const profileHome = getHermesProfileHome(agentId);
  const configPath = path.join(profileHome, "config.yaml");
  const current = fs.existsSync(configPath)
    ? String(fs.readFileSync(configPath, "utf8"))
    : "";
  const config = (current ? (yaml.load(current) as any) : {}) || {};
  config.model = model;

  fs.mkdirSync(profileHome, { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, yaml.dump(config), "utf8");
  fs.renameSync(tmpPath, configPath);
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const agentId = String(body?.agentId || "").trim();
    const model = String(body?.model || "").trim();

    if (!agentId || !model) {
      return NextResponse.json({ ok: false, error: "Missing agentId or model" }, { status: 400 });
    }

    const profileIds = listHermesProfiles();
    if (!profileIds.includes(agentId)) {
      return NextResponse.json({ ok: false, error: `Profile not found: ${agentId}` }, { status: 404 });
    }

    const config = readHermesConfig() || {};
    const knownModels = collectKnownModels(config);
    if (knownModels.size > 0 && !knownModels.has(model)) {
      return NextResponse.json({ ok: false, error: `Unknown model: ${model}` }, { status: 400 });
    }

    if (agentId === "main") {
      await updateMainConfigModel(model);
    } else {
      updateProfileConfigModel(agentId, model);
    }

    clearConfigCache();
    clearAgentSessionModelState(agentId);
    clearConfigCache();

    return NextResponse.json({
      ok: true,
      agentId,
      model,
      applied: true,
      resetSessions: true,
    });
  } catch (err) {
    const error = normalizeErrorMessage(err);
    return NextResponse.json({ ok: false, error }, { status: statusForError(error) });
  }
}
