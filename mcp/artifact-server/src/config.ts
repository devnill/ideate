import { existsSync, readFileSync } from "fs";
import path from "path";

export interface IdeateConfig {
  artifactDir: string;
}

/**
 * Read and parse .ideate.json from a given directory.
 * Returns null if the file doesn't exist or is invalid.
 */
export function readIdeateConfig(dir: string): IdeateConfig | null {
  const configPath = path.join(dir, ".ideate.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    if (typeof raw.artifactDir === "string" && raw.artifactDir.trim() !== "") {
      return { artifactDir: raw.artifactDir.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk up the directory tree from startDir looking for .ideate.json.
 * Returns the resolved absolute artifactDir, or null if not found.
 */
export function findIdeateConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const config = readIdeateConfig(dir);
    if (config) {
      return path.resolve(dir, config.artifactDir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Resolve artifact_dir from tool arguments, falling back to .ideate.json discovery.
 * Throws if neither is available.
 */
export function resolveArtifactDir(
  args: Record<string, unknown>,
  cwd: string = process.cwd()
): string {
  if (typeof args.artifact_dir === "string" && args.artifact_dir.trim() !== "") {
    return args.artifact_dir.trim();
  }
  const found = findIdeateConfig(cwd);
  if (found) return found;
  throw new Error(
    'Required argument "artifact_dir" must be provided, or a .ideate.json file with "artifactDir" must exist in the project directory.'
  );
}
