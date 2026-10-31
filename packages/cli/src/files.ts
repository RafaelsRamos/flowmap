import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIPPED_DIRECTORIES = new Set(["examples", "node_modules", ".git"]);
const FLOW_EXTENSION = /\.(ya?ml|json)$/;
const NOT_A_FLOW = /\.(run|analysis)\.json$/;

/**
 * Flow files under a path: the file itself when it is one (whatever its name),
 * otherwise every *.yml, *.yaml and *.json below the directory, skipping
 * examples/, node_modules/, .git/ and run or analysis documents.
 */
export function collectFiles(absolute: string, shown: string): string[] {
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    throw new Error(`cannot read "${shown}": no such file or directory`);
  }
  if (stats.isFile()) return [absolute];

  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full);
      } else if (FLOW_EXTENSION.test(entry.name) && !NOT_A_FLOW.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(absolute);
  return found;
}
