import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { validateFlowSource, type Issue, type ValidationResult } from "@flowmap/core";
import { collectFiles } from "./files.js";
import { trace } from "./trace.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** The clock `trace` stamps `generatedAt` with. Defaults to the system clock. */
  now?: () => Date;
  /** Environment for credentials and defaults (FLOWMAP_LOKI_*). Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** HTTP client for live backends. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const USAGE = `Usage: flowmap validate <path...> [--json]
       flowmap trace <flow> --<correlationKey> <value> (--logs <file>... | --loki-url <url>) [options]

Validates flow files (YAML or JSON). A directory is searched recursively for
*.yml, *.yaml and *.json files, skipping examples/, node_modules/, .git/ and
*.run.json / *.analysis.json documents.

trace matches the log events of one instance against a flow and prints the
run document (see docs/run-format.md). <flow> is a flow name or a file; flow
names are looked up under --flows (default: flows). The identifier flag is named
after the flow's correlationKey, for example --orderId 4821 (or use --id 4821).

Options:
  --json       print machine-readable results (for trace: {ok, run, summary, warnings})
  -h, --help   show this help

trace options:
  --flows <dir>          where to look for flows by name (default: flows)
  --logs <file>          NDJSON log export; repeat for several files
  --loki-url <url>       read from Loki instead (or FLOWMAP_LOKI_URL)
  --loki-label <name>    stream label holding the log source (default: service)
  --loki-tenant <id>     X-Scope-OrgID for multi-tenant Loki
  --from <time>          start of the search window: ISO 8601 or an age such as 24h, 7d (Loki default: 7d)
  --to <time>            end of the window (default: now)
  --flow-revision <rev>  record which version of the flow this ran against, e.g. git:3f2a9c1

Loki credentials come from the environment, never from flags: FLOWMAP_LOKI_TOKEN,
or FLOWMAP_LOKI_USER and FLOWMAP_LOKI_PASSWORD.

Exit codes: 0 no errors (warnings allowed), 1 validation errors (trace: invalid flow or no events
matched), 2 usage, I/O or backend error.
`;

/** Runs the CLI and returns the process exit code. Never calls process.exit itself. */
export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "trace") return trace(argv.slice(1), io);

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
    files = paths.flatMap((path) => collectFiles(join(io.cwd, path), path));
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
