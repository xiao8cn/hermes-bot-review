import os from "os";
import path from "path";

const home = os.homedir();

export const HERMES_HOME = process.env.HERMES_HOME || path.join(home, ".hermes");
export const HERMES_CONFIG_PATH = path.join(HERMES_HOME, "hermes.json");
export const HERMES_AGENTS_DIR = path.join(HERMES_HOME, "agents");
export const HERMES_PIXEL_OFFICE_DIR = path.join(HERMES_HOME, "pixel-office");

function uniquePaths(paths: Array<string | undefined>): string[] {
  return Array.from(new Set(paths.filter((value): value is string => Boolean(value && value.trim()))));
}

export function getHermesPackageCandidates(version = process.version): string[] {
  const appData = process.env.APPDATA;
  const homebrewPrefix = process.env.HOMEBREW_PREFIX;
  const npmPrefix = process.env.npm_config_prefix || process.env.PREFIX;

  return uniquePaths([
    process.env.HERMES_PACKAGE_DIR,
    path.join(home, ".local", "lib", "node_modules", "hermes"),
    npmPrefix ? path.join(npmPrefix, "node_modules", "hermes") : undefined,
    path.join(home, ".nvm", "versions", "node", version, "lib", "node_modules", "hermes"),
    path.join(home, ".fnm", "node-versions", version, "installation", "lib", "node_modules", "hermes"),
    path.join(home, ".npm-global", "lib", "node_modules", "hermes"),
    path.join(home, ".local", "share", "pnpm", "global", "5", "node_modules", "hermes"),
    path.join(home, "Library", "pnpm", "global", "5", "node_modules", "hermes"),
    appData ? path.join(appData, "npm", "node_modules", "hermes") : undefined,
    homebrewPrefix ? path.join(homebrewPrefix, "lib", "node_modules", "hermes") : undefined,
    "/opt/homebrew/lib/node_modules/hermes",
    "/usr/local/lib/node_modules/hermes",
    "/usr/lib/node_modules/hermes",
  ]);
}