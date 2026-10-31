import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { lokiAdapter, buildQuery, ndjsonAdapter, type LogAdapter } from "@flowmap/adapters";
import { matchRun, validateFlowSource, validateRunSource, type Flow, type Issue } from "@flowmap/core";
import { collectFiles } from "./files.js";
import type { Io } from "./run.js";

const OPTIONS = {
  flows: { type: "string" },
  logs: { type: "string", multiple: true },
  "loki-url": { type: "string" },
  "loki-label": { type: "string" },
  "loki-tenant": { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  id: { type: "string" },
  "flow-revision": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const DEFAULT_LOKI_WINDOW = "7d";
const DURATION = /^(\d+)([smhdw])$/;
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A failure with an exit code and a stable machine-readable code for `--json`. */
class TraceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: 1 | 2,
  ) {
    super(message);
  }
}

/** `flowmap trace`: the arguments after the command name. Returns the exit code. */
export async function trace(argv: string[], io: Io): Promise<number> {
  const json = argv.includes("--json");
  const warnings: string[] = [];
  try {
    const result = await traceOrThrow(argv, io, warnings);
    if (result === "help") return 0;
    if (json) {
      io.stdout(`${JSON.stringify({ ok: true, run: result.run, summary: result.summary, warnings }, null, 2)}\n`);
    } else {
      for (const warning of warnings) io.stderr(`warning: ${warning}\n`);
      io.stdout(`${JSON.stringify(result.run, null, 2)}\n`);
      const { eventsRead, eventsMatched, unexpected } = result.summary;
      io.stderr(
        `✔ traced ${Object.entries(result.run.correlation).map(([k, v]) => `${k} ${v}`).join(", ")}: ` +
          `${eventsMatched} of ${eventsRead} events matched, ${unexpected} unexpected transition${unexpected === 1 ? "" : "s"}\n`,
      );
    }
    return 0;
  } catch (error) {
    if (!(error instanceof TraceError)) throw error;
    if (json) {
      io.stdout(`${JSON.stringify({ ok: false, error: { code: error.code, message: error.message }, warnings }, null, 2)}\n`);
    } else {
      for (const warning of warnings) io.stderr(`warning: ${warning}\n`);
      io.stderr(`error: ${error.message}\n`);
    }
    return error.exit;
  }
}

async function traceOrThrow(argv: string[], io: Io, warnings: string[]) {
  const flowRef = argv.find((arg) => !arg.startsWith("-"));
  if (argv.includes("-h") || argv.includes("--help")) {
    io.stdout("Usage: flowmap trace <flow> --<correlationKey> <value> (--logs <file>... | --loki-url <url>) [options]\nRun flowmap --help for all options.\n");
    return "help" as const;
  }
  if (flowRef === undefined || argv[0] !== flowRef) {
    throw new TraceError("usage", "usage: flowmap trace <flow> --<correlationKey> <value> (--logs <file> | --loki-url <url>)", 2);
  }

  const first = parse(argv.slice(1), {});
  const flow = loadFlow(flowRef, first.flows ?? "flows", io);
  const key = flow.correlationKey;
  if (key in OPTIONS) {
    throw new TraceError("usage", `the flow's correlationKey "${key}" clashes with the --${key} option; pass the value with --id`, 2);
  }

  const values = parse(argv.slice(1), { [key]: { type: "string" } });
  const byKey = values[key] as string | undefined;
  const correlationValue = byKey ?? values.id;
  if (byKey !== undefined && values.id !== undefined && byKey !== values.id) {
    throw new TraceError("usage", `--${key} and --id disagree (${byKey} vs ${values.id}); pass one`, 2);
  }
  if (correlationValue === undefined || correlationValue === "") {
    throw new TraceError("usage", `flow "${flow.flow}" is traced by ${key}: pass --${key} <value>`, 2);
  }

  const env = io.env ?? process.env;
  const lokiUrl = values["loki-url"] ?? env.FLOWMAP_LOKI_URL;
  const logs = values.logs ?? [];
  if (logs.length > 0 && lokiUrl !== undefined) throw new TraceError("usage", "pass either --logs or --loki-url, not both", 2);
  if (logs.length === 0 && lokiUrl === undefined) {
    throw new TraceError("usage", "no log source: pass --logs <file.ndjson> or --loki-url <url>", 2);
  }

  const now = io.now?.() ?? new Date();
  const to = parseTime(values.to, now, "--to") ?? now;
  const from = parseTime(values.from ?? (lokiUrl !== undefined && logs.length === 0 ? DEFAULT_LOKI_WINDOW : undefined), now, "--from");

  let adapter: LogAdapter;
  if (logs.length > 0) {
    adapter = ndjsonAdapter(logs.map((path) => join(io.cwd, path)));
  } else {
    const token = env.FLOWMAP_LOKI_TOKEN;
    const user = env.FLOWMAP_LOKI_USER;
    const password = env.FLOWMAP_LOKI_PASSWORD;
    adapter = lokiAdapter({
      url: lokiUrl as string,
      ...(values["loki-label"] === undefined ? {} : { sourceLabel: values["loki-label"] }),
      ...(values["loki-tenant"] === undefined ? {} : { tenant: values["loki-tenant"] }),
      ...(token === undefined ? {} : { bearerToken: token }),
      ...(token === undefined && user !== undefined && password !== undefined ? { basicAuth: { user, password } } : {}),
      ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
    });
  }

  let fetched;
  try {
    fetched = await adapter.fetch(buildQuery(flow, correlationValue, { ...(from === undefined ? {} : { from }), to }));
  } catch (error) {
    throw new TraceError("backend", (error as Error).message, 2);
  }
  warnings.push(...fetched.warnings);

  const run = matchRun({
    flow,
    events: fetched.events,
    correlationValue,
    generatedAt: now.toISOString(),
    ...(values["flow-revision"] === undefined ? {} : { flowRevision: values["flow-revision"] }),
  });

  const matched = new Set(Object.values(run.nodes).flatMap((node) => node.evidence?.map((entry) => entry.ref) ?? []));
  if (matched.size === 0) {
    throw new TraceError(
      "no-events",
      `no events matched flow "${flow.flow}" with ${key} ${correlationValue} (${fetched.events.length} event${fetched.events.length === 1 ? "" : "s"} read from ${adapter.name}); check the id, the search window and the nodes' evidence.source / match.correlate`,
      1,
    );
  }

  // The engine's output must satisfy the same validator everyone else uses.
  const checked = validateRunSource(JSON.stringify(run), "run", { flow });
  if (!checked.ok) {
    throw new TraceError("invalid-run", `internal error: the generated run is invalid: ${checked.issues.map((i: Issue) => i.message).join("; ")}`, 1);
  }

  return { run, summary: { eventsRead: fetched.events.length, eventsMatched: matched.size, unexpected: run.unexpected.length } };
}

function parse(args: string[], extra: Record<string, { type: "string" }>) {
  try {
    const { values } = parseArgs({ args, options: { ...OPTIONS, ...extra }, strict: Object.keys(extra).length > 0, allowPositionals: true });
    return values as Record<string, string | string[] | boolean | undefined> & {
      flows?: string;
      logs?: string[];
      "loki-url"?: string;
      "loki-label"?: string;
      "loki-tenant"?: string;
      from?: string;
      to?: string;
      id?: string;
      "flow-revision"?: string;
    };
  } catch (error) {
    throw new TraceError("usage", (error as Error).message, 2);
  }
}

function loadFlow(ref: string, flowsDir: string, io: Io): Flow {
  const direct = join(io.cwd, ref);
  let isFile = false;
  try {
    isFile = statSync(direct).isFile();
  } catch {
    // not a path: look it up by name below
  }
  if (isFile) {
    const result = validateFlowSource(readFileSync(direct, "utf8"), ref);
    if (!result.ok || result.flow === undefined) {
      throw new TraceError("invalid-flow", `${ref} is not a valid flow:\n${formatIssues(ref, result.issues)}`, 1);
    }
    return result.flow;
  }

  let files: string[];
  try {
    files = collectFiles(join(io.cwd, flowsDir), flowsDir);
  } catch (error) {
    throw new TraceError("flow-not-found", `no flow "${ref}": ${(error as Error).message}`, 2);
  }
  let invalid = 0;
  for (const file of files) {
    const result = validateFlowSource(readFileSync(file, "utf8"), relative(io.cwd, file));
    if (result.ok && result.flow?.flow === ref) return result.flow;
    if (!result.ok) invalid += 1;
  }
  const hint = invalid > 0 ? ` (${invalid} file${invalid === 1 ? "" : "s"} in it failed validation; run flowmap validate ${flowsDir})` : "";
  throw new TraceError("flow-not-found", `no valid flow named "${ref}" under ${flowsDir}${hint}`, invalid > 0 ? 1 : 2);
}

function formatIssues(file: string, issues: Issue[]): string {
  return issues.map((i) => `  ${file}:${i.line}:${i.column}  ${i.severity}  ${i.message}  [${i.code}]`).join("\n");
}

/** An ISO 8601 timestamp with a zone, or an age such as `24h` meaning that long before now. */
function parseTime(text: string | undefined, now: Date, flag: string): Date | undefined {
  if (text === undefined) return undefined;
  const age = DURATION.exec(text);
  if (age?.[1] !== undefined && age[2] !== undefined) {
    return new Date(now.getTime() - Number(age[1]) * (UNIT_SECONDS[age[2]] ?? 0) * 1000);
  }
  if (TIMESTAMP.test(text) && !Number.isNaN(Date.parse(text))) return new Date(text);
  throw new TraceError("usage", `${flag} "${text}" is not an ISO 8601 timestamp with a time zone or an age like 24h, 7d`, 2);
}
