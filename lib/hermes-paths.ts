import os from "os";
import path from "path";
import fs from "fs";

const home = os.homedir();

export const HERMES_HOME = process.env.HERMES_HOME || path.join(home, ".hermes");
export const HERMES_CONFIG_PATH = path.join(HERMES_HOME, "config.yaml");
export const HERMES_SESSIONS_DIR = path.join(HERMES_HOME, "sessions");
export const HERMES_PROFILES_DIR = path.join(HERMES_HOME, "profiles");

/**
 * Returns the home directory for a given profile.
 * "main" maps to HERMES_HOME itself; all other profile names map to ~/.hermes/profiles/{name}/.
 */
export function getHermesProfileHome(profileId: string): string {
  if (profileId === "main") return HERMES_HOME;
  return path.join(HERMES_PROFILES_DIR, profileId);
}

/**
 * Returns the sessions directory for a given profile.
 * Hermes stores sessions in {profileHome}/sessions/.
 */
export function getHermesProfileSessionsDir(profileId: string): string {
  return path.join(getHermesProfileHome(profileId), "sessions");
}

/**
 * Lists all available Hermes profiles.
 * Always includes "main"; also includes any subdirectories under ~/.hermes/profiles/.
 */
export function listHermesProfiles(): string[] {
  const profiles: string[] = ["main"];
  try {
    const dirs = fs.readdirSync(HERMES_PROFILES_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && !d.name.startsWith(".")) {
        profiles.push(d.name);
      }
    }
  } catch {
    // profiles/ directory does not exist — only "main" is available
  }
  return profiles;
}
