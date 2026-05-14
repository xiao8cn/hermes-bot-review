import { NextResponse } from "next/server";

function resolveAlertConfig() {
  const enabled = process.env.ALERTS_ENABLED === "1" || process.env.ALERTS_ENABLED === "true";
  const checkInterval = Number(process.env.ALERTS_CHECK_INTERVAL_MINUTES || "10");
  return {
    enabled,
    checkInterval: Number.isFinite(checkInterval) && checkInterval > 0 ? checkInterval : 10,
  };
}

export async function GET() {
  try {
    return NextResponse.json(resolveAlertConfig());
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
}
