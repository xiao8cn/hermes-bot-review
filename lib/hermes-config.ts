import fs from "fs";
import yaml from "js-yaml";
import { HERMES_CONFIG_PATH } from "@/lib/hermes-paths";

/**
 * Reads and parses ~/.hermes/config.yaml.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readHermesConfig(): any {
  try {
    const raw = fs.readFileSync(HERMES_CONFIG_PATH, "utf-8");
    return yaml.load(raw) || {};
  } catch {
    return null;
  }
}
