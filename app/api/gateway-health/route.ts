import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readHermesConfig } from "@/lib/hermes-config";

const DEGRADED_LATENCY_MS = 1500;
const execFileAsync = promisify(execFile);
let cachedHermesVersion: { value: string | null; expiresAt: number } | null = null;

async function execHermes(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, FORCE_COLOR: "0" };
  const executable = process.platform === "win32" ? "hermes.cmd" : "hermes";
  return execFileAsync(executable, args, {
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
}

function parseGatewayStatusOutput(output: string): { ok: boolean; error?: string } {
  const normalized = output.toLowerCase();

  if (
    normalized.includes("gateway service is loaded") ||
    normalized.includes("service definition matches the current hermes install")
  ) {
    return { ok: true };
  }

  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = [...lines].reverse().find((line) => {
    const lower = line.toLowerCase();
    return lower.includes("error") || lower.includes("failed") || lower.includes("not loaded") || lower.includes("not running");
  });

  return {
    ok: false,
    error: errorLine || "Failed to interpret hermes gateway status output",
  };
}

async function probeGatewayViaCli(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { stdout, stderr } = await execHermes(["gateway", "status"]);
    return parseGatewayStatusOutput(`${stdout}\n${stderr || ""}`);
  } catch (err: any) {
    const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
    const stdout = typeof err?.stdout === "string" ? err.stdout.trim() : "";
    const message = stderr || stdout || err?.message || "Failed to run hermes gateway status";
    return { ok: false, error: message };
  }
}

async function probeGatewayViaWeb(port: number, token: string, timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(
      `http://localhost:${port}/chat${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      { signal: controller.signal, cache: "no-store", redirect: "manual" },
    );
    return resp.status >= 200 && resp.status < 400
      ? { ok: true }
      : { ok: false, error: `HTTP ${resp.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Failed to probe gateway web UI" };
  } finally {
    clearTimeout(timeout);
  }
}

async function getHermesVersion(): Promise<string | undefined> {
  const now = Date.now();
  if (cachedHermesVersion && cachedHermesVersion.expiresAt > now) {
    return cachedHermesVersion.value || undefined;
  }
  try {
    const { stdout } = await execHermes(["--version"]);
    const version = stdout.trim().split(/\s+/)[0] || null;
    cachedHermesVersion = { value: version, expiresAt: now + 60 * 60 * 1000 };
    return version || undefined;
  } catch {
    cachedHermesVersion = { value: null, expiresAt: now + 60 * 1000 };
    return undefined;
  }
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const hermesVersion = await getHermesVersion();
    const config = readHermesConfig() || {};
    const port = config.gateway?.port || 18789;
    const token = config.gateway?.auth?.token || "";
    const webUrl = `http://localhost:${port}/chat${token ? '?token=' + encodeURIComponent(token) : ''}`;

    const url = `http://localhost:${port}/api/health`;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (resp.ok) {
      const checkedAt = Date.now();
      const responseMs = checkedAt - startedAt;
      const data = await resp.json().catch(() => null);
      return NextResponse.json({
        ok: true,
        data,
        hermesVersion,
        status: responseMs > DEGRADED_LATENCY_MS ? "degraded" : "healthy",
        checkedAt,
        responseMs,
        webUrl,
      });
    }

    const web = await probeGatewayViaWeb(port, token, 5000);
    if (web.ok) {
      const checkedAt = Date.now();
      const responseMs = checkedAt - startedAt;
      return NextResponse.json({
        ok: true,
        data: null,
        hermesVersion,
        status: resp.status === 404 ? "healthy" : "degraded",
        checkedAt,
        responseMs,
        webUrl,
      });
    }

    // Hermes may not serve /api/health; fallback to CLI probe.
    const cli = await probeGatewayViaCli();
    const checkedAt = Date.now();
    const responseMs = checkedAt - startedAt;
    if (cli.ok) {
      return NextResponse.json({
        ok: true,
        data: null,
        hermesVersion,
        status: "healthy",
        checkedAt,
        responseMs,
        webUrl,
      });
    }

    return NextResponse.json({
      ok: false,
      hermesVersion,
      error: cli.error || `HTTP ${resp.status}`,
      status: "down",
      checkedAt,
      responseMs,
    });
  } catch (err: any) {
    const hermesVersion = await getHermesVersion();
    // If HTTP probe fails due to transport/runtime issues, attempt CLI probe before declaring down.
    const raw = err.cause?.code === "ECONNREFUSED"
      ? "Gateway 未运行"
      : err.name === "AbortError"
        ? "请求超时"
        : err.message;
    const token = (() => {
      try {
        const cfg = readHermesConfig() || {};
        return cfg.gateway?.auth?.token || "";
      } catch {
        return "";
      }
    })();
    const port = (() => {
      try {
        const cfg = readHermesConfig() || {};
        return cfg.gateway?.port || 18789;
      } catch {
        return 18789;
      }
    })();
    const web = await probeGatewayViaWeb(port, token, 5000);
    if (web.ok) {
      const checkedAt = Date.now();
      const responseMs = checkedAt - startedAt;
      return NextResponse.json({
        ok: true,
        data: null,
        hermesVersion,
        status: "degraded",
        checkedAt,
        responseMs,
        webUrl: `http://localhost:${port}/chat${token ? '?token=' + encodeURIComponent(token) : ''}`,
      });
    }
    const cli = await probeGatewayViaCli();
    const checkedAt = Date.now();
    const responseMs = checkedAt - startedAt;
    if (cli.ok) {
      return NextResponse.json({
        ok: true,
        data: null,
        hermesVersion,
        status: "healthy",
        checkedAt,
        responseMs,
        webUrl: `http://localhost:${port}/chat${token ? '?token=' + encodeURIComponent(token) : ''}`,
      });
    }
    return NextResponse.json({
      ok: false,
      hermesVersion,
      error: cli.error || raw,
      status: "down",
      checkedAt,
      responseMs,
    });
  }
}
