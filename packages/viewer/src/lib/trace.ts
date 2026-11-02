import { parseLogText, parseNdjson, readLogFormat, type TextFormat } from "@flowmap/adapters";
import { matchRun, parseSource, validateRunSource, type Flow, type LogEvent, type Run } from "@flowmap/core";

/** One log supplied by hand: a file picked in the browser, or text pasted into the page. */
export interface LogInput {
  name: string;
  text: string;
  /** Pasted text has no file name to take a source from; its lines must name one. */
  pasted?: boolean;
}

export interface TraceSummary {
  eventsRead: number;
  eventsMatched: number;
  unexpected: number;
}

export type TraceOutcome =
  | { ok: true; run: Run; warnings: string[]; summary: TraceSummary }
  | { ok: false; error: string; warnings: string[] };

const STRICT_JSON_LINES = /\.(ndjson|jsonl)$/i;

/**
 * What `flowmap trace` does, for logs the user supplies in the browser: read
 * the logs, match them against the flow for one correlation value, and check
 * the result with the run validator. Pure: the clock is passed in.
 */
export function traceFromLogs(input: {
  flow: Flow;
  correlationValue: string;
  logs: LogInput[];
  /** Optional log format, as JSON or YAML text; see docs/adapters.md. */
  format?: string;
  now: Date;
}): TraceOutcome {
  const warnings: string[] = [];
  const value = input.correlationValue.trim();
  if (value === "") return { ok: false, error: `Enter the ${input.flow.correlationKey} to trace.`, warnings };
  if (input.logs.length === 0) return { ok: false, error: "Add a log file or paste some log lines.", warnings };

  let format: TextFormat | undefined;
  if (input.format !== undefined && input.format.trim() !== "") {
    const parsed = parseSource(input.format, "a log format");
    if (parsed.issues.length > 0) return { ok: false, error: `Log format: ${parsed.issues[0]?.message ?? "cannot be parsed"}`, warnings };
    try {
      format = readLogFormat(parsed.data);
    } catch (error) {
      return { ok: false, error: (error as Error).message, warnings };
    }
  }

  const events: LogEvent[] = [];
  for (const log of input.logs) {
    const extension = /\.[^.]+$/.exec(log.name)?.[0] ?? "";
    const result = STRICT_JSON_LINES.test(log.name)
      ? parseNdjson(log.text, log.name)
      : parseLogText(log.text, log.name, {
          ...(format === undefined ? {} : { format }),
          ...(log.pasted === true ? {} : { defaultSource: extension === "" ? log.name : log.name.slice(0, -extension.length) }),
        });
    events.push(...result.events);
    warnings.push(...result.warnings);
  }

  let run: Run;
  try {
    run = matchRun({ flow: input.flow, events, correlationValue: value, generatedAt: input.now.toISOString() });
  } catch (error) {
    return { ok: false, error: (error as Error).message, warnings };
  }

  const matched = new Set(Object.values(run.nodes).flatMap((node) => node.evidence?.map((entry) => entry.ref) ?? []));
  if (matched.size === 0) {
    return {
      ok: false,
      error: `No events matched ${input.flow.correlationKey} ${value} (${events.length} event${events.length === 1 ? "" : "s"} read). Check the id, and that the lines name a source and event the flow expects.`,
      warnings,
    };
  }

  const checked = validateRunSource(JSON.stringify(run), "run", { flow: input.flow });
  if (!checked.ok) return { ok: false, error: `Internal error: the traced run is invalid: ${checked.issues.map((issue) => issue.message).join("; ")}`, warnings };

  return { ok: true, run, warnings, summary: { eventsRead: events.length, eventsMatched: matched.size, unexpected: run.unexpected.length } };
}
