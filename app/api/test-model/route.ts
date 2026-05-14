import { NextResponse } from "next/server";
import { parseModelRef, probeModel, DEFAULT_MODEL_PROBE_TIMEOUT_MS } from "@/lib/model-probe";

const PROBE_TIMEOUT_MS = DEFAULT_MODEL_PROBE_TIMEOUT_MS;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
    const modelRefRaw = typeof body?.model === "string" ? body.model.trim() : "";

    const modelRef = modelRefRaw || (provider && modelId ? `${provider}/${modelId}` : modelId || provider);
    if (!modelRef) {
      return NextResponse.json({ ok: false, error: "Missing model parameters", elapsed: 0 }, { status: 400 });
    }

    const { providerId, modelId: parsedModelId } = parseModelRef(modelRef);
    const result = await probeModel({
      providerId,
      modelId: parsedModelId,
      modelRef,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

    return NextResponse.json({
      ok: result.ok,
      text: result.text,
      error: result.error,
      elapsed: result.elapsed,
      model: result.model,
      status: result.status,
      mode: result.mode,
      source: result.source,
      precision: result.precision,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Internal server error", elapsed: 0 }, { status: 500 });
  }
}
