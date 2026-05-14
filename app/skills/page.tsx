"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface Skill {
  id: string;
  name: string;
  description: string;
  emoji: string;
  source: string;
  usedBy: string[];
}

interface AgentInfo {
  name: string;
  emoji: string;
}

interface SkillsResponse {
  skills?: unknown[];
  agents?: unknown;
  total?: number;
}

const GROUP_COLORS = [
  "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  "bg-lime-500/20 text-lime-300 border-lime-500/30",
];

function normalizeSkill(raw: unknown): Skill | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" && value.name.trim() ? value.name : id;
  const source = typeof value.source === "string" && value.source.trim() ? value.source : "custom";

  if (!id) return null;

  return {
    id,
    name,
    description: typeof value.description === "string" ? value.description : "",
    emoji: typeof value.emoji === "string" && value.emoji.trim() ? value.emoji : "🧩",
    source,
    usedBy: Array.isArray(value.usedBy)
      ? value.usedBy.filter((agentId): agentId is string => typeof agentId === "string" && agentId.trim().length > 0)
      : [],
  };
}

function normalizeAgents(raw: unknown): Record<string, AgentInfo> {
  if (!raw || typeof raw !== "object") return {};

  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([agentId, info]) => {
      if (!info || typeof info !== "object") return null;
      const value = info as Record<string, unknown>;
      return [
        agentId,
        {
          name: typeof value.name === "string" && value.name.trim() ? value.name : agentId,
          emoji: typeof value.emoji === "string" && value.emoji.trim() ? value.emoji : "🤖",
        },
      ] as const;
    })
    .filter((entry): entry is readonly [string, AgentInfo] => Boolean(entry));

  return Object.fromEntries(entries);
}

export default function SkillsPage() {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillContent, setSkillContent] = useState<Record<string, string>>({});
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/skills")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.error) {
          setError(data.error);
          return;
        }

        const rawSkills = Array.isArray(data?.skills) ? (data.skills as unknown[]) : [];
        const normalizedSkills = rawSkills
          .map(normalizeSkill)
          .filter((skill: Skill | null): skill is Skill => skill !== null);

        setSkills(normalizedSkills);
        setAgents(normalizeAgents(data?.agents));
        setTotalCount(typeof data?.total === "number" ? data.total : normalizedSkills.length);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function formatGroupLabel(group: string): string {
    return group
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getGroupBadgeClass(group: string): string {
    const hash = group.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return GROUP_COLORS[hash % GROUP_COLORS.length];
  }

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) {
      counts.set(skill.source, (counts.get(skill.source) || 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [skills]);

  const filters = useMemo(() => ([
    { key: "all", label: t("skills.all"), count: skills.length },
    ...groupCounts.map(([group, count]) => ({ key: group, label: formatGroupLabel(group), count })),
  ]), [groupCounts, skills.length, t]);

  const filtered = useMemo(() => {
    return skills.filter((skill) => {
      if (filter !== "all" && skill.source !== filter) return false;

      if (!search) return true;
      const query = search.toLowerCase();
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query)
      );
    });
  }, [filter, search, skills]);

  useEffect(() => {
    if (!selectedSkill) return;

    const cacheKey = `${selectedSkill.source}:${selectedSkill.id}`;
    if (skillContent[cacheKey]) {
      setContentError(null);
      setContentLoading(false);
      return;
    }

    const controller = new AbortController();
    setContentLoading(true);
    setContentError(null);

    fetch(`/api/skills/content?source=${encodeURIComponent(selectedSkill.source)}&id=${encodeURIComponent(selectedSkill.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        return data;
      })
      .then((data) => {
        const content = typeof data?.content === "string" ? data.content : "";
        setSkillContent((prev) => ({ ...prev, [cacheKey]: content }));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setContentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setContentLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedSkill, skillContent]);

  useEffect(() => {
    if (!selectedSkill) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSkill(null);
        setContentError(null);
        setContentLoading(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedSkill]);

  const selectedSkillCacheKey = selectedSkill ? `${selectedSkill.source}:${selectedSkill.id}` : "";
  const selectedSkillContent = selectedSkill ? skillContent[selectedSkillCacheKey] : "";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)]">{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-400">{t("common.loadError")}: {error}</p>
      </div>
    );
  }

  const enabledCount = totalCount || skills.length;

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-2xl shadow-sm">
            🧩
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t("skills.title")}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {enabledCount}/{totalCount || skills.length} {t("skills.enabled")}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-xl">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">⌕</span>
          <input
            type="text"
            placeholder={t("skills.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--accent)]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((nextFilter) => (
            <button
              key={nextFilter.key}
              onClick={() => setFilter(nextFilter.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === nextFilter.key
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>{nextFilter.label}</span>
              <span className={filter === nextFilter.key ? "opacity-80" : "text-[var(--text-muted)]"}>
                ({nextFilter.count})
              </span>
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)] lg:ml-auto">
          {t("skills.showing")} {filtered.length} {t("skills.unit")}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">
              {t("common.noData")}
            </div>
          ) : (
            <div>
              {filtered.map((skill) => {
                const active = selectedSkill?.source === skill.source && selectedSkill?.id === skill.id;
                return (
                  <button
                    key={`${skill.source}-${skill.id}`}
                    type="button"
                    onClick={() => setSelectedSkill(skill)}
                    className={`flex w-full items-start gap-3 border-b border-[var(--border)] px-4 py-4 text-left transition last:border-b-0 hover:bg-[var(--bg)]/50 ${active ? "bg-[var(--bg)]/60" : ""}`}
                  >
                    <span className="mt-0.5 inline-flex items-center">
                      <input type="checkbox" checked readOnly className="h-4 w-4 rounded border-[var(--border)] bg-[var(--bg)] accent-[var(--accent)]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--text)]">{skill.id}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getGroupBadgeClass(skill.source)}`}>
                          {formatGroupLabel(skill.source)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {skill.description || t("skills.noDesc")}
                      </p>
                      {skill.usedBy.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {skill.usedBy.map((agentId) => {
                            const agent = agents[agentId];
                            return (
                              <span key={agentId} className="inline-flex items-center gap-1 rounded bg-[var(--bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                                <span>{agent?.emoji || "🤖"}</span>
                                <span>{agent?.name || agentId}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <span className="pt-0.5 text-xs text-[var(--text-muted)]">SKILL.md</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-4 self-start rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <div className="text-sm font-semibold text-[var(--text)]">{selectedSkill ? `${selectedSkill.emoji} ${selectedSkill.name}` : t("skills.contentTitle")}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {selectedSkill ? formatGroupLabel(selectedSkill.source) : t("skills.loadingContent")}
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto bg-[var(--bg)]/35">
            {!selectedSkill ? (
              <div className="p-4 text-sm text-[var(--text-muted)]">
                {t("skills.selectSkill")}
              </div>
            ) : contentLoading && !selectedSkillContent ? (
              <div className="p-4 text-sm text-[var(--text-muted)]">{t("skills.loadingContent")}</div>
            ) : contentError ? (
              <div className="p-4 text-sm text-red-400">{t("skills.contentLoadFailed")}: {contentError}</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-6 font-mono text-[var(--text)]">
                {selectedSkillContent}
              </pre>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
