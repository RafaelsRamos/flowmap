import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateFlowSource, type Issue, type ValidationResult } from "@flowmap/core";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

const USAGE = `Usage: flowmap validate <path...> [--json]

Validates flow files (YAML or JSON). A directory is searched recursively for
*.yml, *.yaml and *.json files, skipping examples/, node_modules/, .git/ and
*.run.json / *.analysis.json documents.

Options:
  --json       print machine-readable results
  -h, --help   show this help

Exit codes: 0 no errors (warnings allowed), 1 validation errors, 2 usage or I/O error.
`;

const SKIPPED_DIRECTORIES = new Set(["examples", "node_modules", ".git"]);
const FLOW_EXTENSION = /\.(ya?ml|json)$/;
const NOT_A_FLOW = /\.(run|analysis)\.json$/;

/** Runs the CLI and returns the process exit code. Never calls process.exit itself. */
export function run(argv: string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  const [command, ...paths] = parsed.positionals;
  if (parsed.values.help || command === undefined) {
    (parsed.values.help ? io.stdout : io.stderr)(USAGE);
    return parsed.values.help ? 0 : 2;
  }
  if (command !== "validate") {
    io.stderr(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }
  if (paths.length === 0) {
    io.stderr(`validate needs at least one file or directory\n\n${USAGE}`);
    return 2;
  }

  let files: string[];
  try {
    files = paths.flatMap((path) => collectFiles(resolve(io.cwd, path), path));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }
  if (files.length === 0) {
    io.stderr(`no flow files found in: ${paths.join(", ")}\n`);
    return 2;
  }

  const results: ValidationResult[] = files.map((file) => {
    const display = relative(io.cwd, file) || file;
    const { flow: _flow, ...result } = validateFlowSource(readFileSync(file, "utf8"), display);
    return result;
  });

  const errors = count(results, "error");
  const warnings = count(results, "warning");

  if (parsed.values.json) {
    io.stdout(
      `${JSON.stringify({ ok: errors === 0, summary: { files: results.length, errors, warnings }, files: results }, null, 2)}\n`,
    );
  } else {
    io.stdout(formatText(results, errors, warnings));
  }
  return errors === 0 ? 0 : 1;
}

function collectFiles(absolute: string, shown: string): string[] {
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    throw new Error(`cannot read "${shown}": no such file or directory`);
  }
  // A file named on the command line is always validated, whatever its name.
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

function count(results: ValidationResult[], severity: Issue["severity"]): number {
  return results.reduce((sum, r) => sum + r.issues.filter((i) => i.severity === severity).length, 0);
}

function formatText(results: ValidationResult[], errors: number, warnings: number): string {
  const lines: string[] = [];
  for (const result of results) {
    for (const issue of result.issues) {
      lines.push(
        `${result.file}:${issue.line}:${issue.column}  ${issue.severity}  ${issue.message}  [${issue.code}]`,
      );
    }
  }
  const files = `${results.length} file${results.length === 1 ? "" : "s"}`;
  const problems =
    errors === 0 && warnings === 0
      ? "no problems"
      : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  lines.push(`${errors === 0 ? "✔" : "✖"} ${problems} in ${files}`);
  return `${lines.join("\n")}\n`;
}
