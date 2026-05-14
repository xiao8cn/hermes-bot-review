import { NextResponse } from "next/server";
import { DEFAULT_MODEL_PROBE_TIMEOUT_MS, parseModelRef, probeModel } from "@/lib/model-probe";
import { listHermesProfiles } from "@/lib/hermes-paths";
import { readHermesConfig } from "@/lib/hermes-config";

const PROBE_TIMEOUT_MS = DEFAULT_MODEL_PROBE_TIMEOUT_MS;

type AgentConfig = {
  id: string;
  model?: string;
};

function normalizeProbeError(error: string | undefined, modelRef: string): string | undefined {
  if (!error) return error;
  const normalized = error.toLowerCase();
  if (!normalized.includes(".env") && !normalized.includes("api_key") && !normalized.includes("api key")) {
    return error;
  }

  const providerId = modelRef.includes("/") ? modelRef.split("/")[0] : modelRef;
  return `Provider '${providerId}' authentication failed. Please check ~/.hermes/config.yaml provider credentials (api_key/base_url).`;
}

function loadAgentList(config: any): AgentConfig[] {
  const profileIds = listHermesProfiles();
  if (profileIds.length === 0) return [{ id: "main" }];

  return profileIds.map((id) => {
    if (id === "main") {
      const mainModel =
        typeof config?.model === "string"
          ? config.model
          : config?.model?.primary || config?.model?.default;
      return { id, model: mainModel };
    }

    return { id };
  });
}

export async function POST() {
  try {
    const config = readHermesConfig() || {};
    const defaultModel =
      typeof config?.model === "string"
        ? config.model
        : config?.model?.primary || config?.model?.default || "unknown";

    const agentList = loadAgentList(config);
    const modelProbeTasks = new Map<string, Promise<Awaited<ReturnType<typeof probeModel>>>>();

    for (const agent of agentList) {
      const modelStr = agent.model || defaultModel;
      const { providerId, modelId } = parseModelRef(modelStr);
      const key = modelStr;
      if (!modelProbeTasks.has(key)) {
        modelProbeTasks.set(key, probeModel({ providerId, modelId, modelRef: modelStr, timeoutMs: PROBE_TIMEOUT_MS }));
      }
    }

    const modelProbeResults = new Map<string, Awaited<ReturnType<typeof probeModel>>>();
    for (const [key, task] of modelProbeTasks.entries()) {
      modelProbeResults.set(key, await task);
    }

    const results = agentList.map((agent) => {
      const modelStr = agent.model || defaultModel;
      const { providerId, modelId } = parseModelRef(modelStr);
      const key = modelStr;
      const probe = modelProbeResults.get(key);

      if (!probe) {
        return {
          agentId: agent.id,
          model: modelStr,
          ok: false,
          error: `No probe result for model ${key}`,
          elapsed: 0,
          status: "unknown",
          mode: "unknown",
          precision: "provider",
          source: "hermes_provider_probe",
        };
      }

      return {
        agentId: agent.id,
        model: modelStr,
        ok: probe.ok,
        text: probe.text,
        error: normalizeProbeError(probe.error, modelStr),
        elapsed: probe.elapsed,
        status: probe.status,
        mode: probe.mode,
        precision: probe.precision,
        source: probe.source,
      };
    });

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
