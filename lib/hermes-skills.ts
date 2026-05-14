import fs from "fs";
import path from "path";
import { HERMES_HOME, listHermesProfiles, getHermesProfileSessionsDir } from "@/lib/hermes-paths";
import { readHermesConfig } from "@/lib/hermes-config";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  emoji: string;
  source: string;
  location: string;
  usedBy: string[];
}

export interface SkillAgentInfo {
  name: string;
  emoji: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!content.startsWith("---")) return result;
  const parts = content.split("---", 3);
  if (parts.length < 3) return result;
  const fm = parts[1];

  const nameMatch = fm.match(/^name:\s*(.+)/m);
  if (nameMatch) result.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

  const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  if (descMatch) result.description = descMatch[1].trim().replace(/^["']|["']$/g, "");

  const emojiMatch = fm.match(/"emoji":\s*"([^"]+)"/);
  if (emojiMatch) result.emoji = emojiMatch[1];

  return result;
}

function readSkillFile(skillMd: string, source: string, id = path.basename(path.dirname(skillMd))): SkillInfo | null {
  if (!fs.existsSync(skillMd)) return null;
  const content = fs.readFileSync(skillMd, "utf-8");
  const fm = parseFrontmatter(content);
  return {
    id,
    name: fm.name || id,
    description: fm.description || "",
    emoji: fm.emoji || "🔧",
    source,
    location: skillMd,
    usedBy: [],
  };
}

function scanSkillsTree(dir: string, source: string, skills: SkillInfo[] = []): SkillInfo[] {
  if (!fs.existsSync(dir)) return skills;

  const skillMd = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const skill = readSkillFile(skillMd, source, path.basename(dir));
    if (skill) skills.push(skill);
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    scanSkillsTree(path.join(dir, entry.name), source, skills);
  }

  return skills;
}

function scanHermesSkillsRoot(rootDir: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!fs.existsSync(rootDir)) return skills;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    scanSkillsTree(path.join(rootDir, entry.name), entry.name, skills);
  }

  return skills;
}

function getAgentSkillsFromSessions(): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  const profileIds = listHermesProfiles();

  for (const profileId of profileIds) {
    const sessionsDir = getHermesProfileSessionsDir(profileId);
    if (!fs.existsSync(sessionsDir)) continue;

    const jsonlFiles = fs.readdirSync(sessionsDir)
      .filter((file) => file.endsWith(".jsonl"))
      .sort();
    const skillNames = new Set<string>();

    for (const file of jsonlFiles.slice(-3)) {
      const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
      const idx = content.indexOf("skillsSnapshot");
      if (idx < 0) continue;
      const chunk = content.slice(idx, idx + 5000);
      const matches = chunk.matchAll(/\\?"name\\?":\s*\\?"([^"\\]+)\\?"/g);
      for (const match of matches) {
        const name = match[1];
        if (!["exec", "read", "edit", "write", "process", "message", "web_search", "web_fetch",
              "browser", "tts", "gateway", "memory_search", "memory_get", "cron", "nodes",
              "canvas", "session_status", "sessions_list", "sessions_history", "sessions_send",
              "sessions_spawn", "agents_list"].includes(name) && name.length > 1) {
          skillNames.add(name);
        }
      }
    }

    if (skillNames.size > 0) result[profileId] = skillNames;
  }

  return result;
}

export function listHermesSkills(): { skills: SkillInfo[]; agents: Record<string, SkillAgentInfo>; total: number } {
  const allSkills = scanHermesSkillsRoot(path.join(HERMES_HOME, "skills"));

  const agentSkills = getAgentSkillsFromSessions();
  for (const skill of allSkills) {
    for (const [profileId, skills] of Object.entries(agentSkills)) {
      if (skills.has(skill.id) || skills.has(skill.name)) {
        skill.usedBy.push(profileId);
      }
    }
  }

  const profileIds = listHermesProfiles();
  const config = readHermesConfig() || {};
  const agents: Record<string, SkillAgentInfo> = {};
  for (const id of profileIds) {
    const configuredAgent = Array.isArray(config?.agents?.list)
      ? config.agents.list.find((agent: any) => agent && agent.id === id)
      : null;
    agents[id] = {
      name: configuredAgent?.name || configuredAgent?.identity?.name || id,
      emoji: configuredAgent?.identity?.emoji || configuredAgent?.emoji || "🤖",
    };
  }

  return { skills: allSkills, agents, total: allSkills.length };
}

export function getHermesSkillContent(source: string, id: string): { skill: SkillInfo; content: string } | null {
  const { skills } = listHermesSkills();
  const skill = skills.find((entry) => entry.source === source && entry.id === id);
  if (!skill) return null;
  return {
    skill,
    content: fs.readFileSync(skill.location, "utf-8"),
  };
}
