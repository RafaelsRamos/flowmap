import type { LogEvent } from "@flowmap/core";
import { capRaw, normaliseRecord } from "./normalise.js";
import type { AdapterResult } from "./types.js";

/**
 * How to read plain-text logs (`.log`, `.txt`), for lines the automatic readers
 * do not understand. Written as a small JSON or YAML file and passed with
 * `--log-format`, or pasted into the viewer.
 */
export interface TextFormat {
  /**
   * A regular expression with named groups, tried on every line. `ts`, `source`,
   * `event` and `msg` groups fill those fields; any other named group becomes an
   * attribute. Example: `^(?<ts>\S+ \S+) (?<level>\w+) (?<msg>.*)$`.
   */
  pattern?: string;
  /**
   * Names an event from the message when the line has no `event` of its own. The
   * first rule whose regex matches wins, and its named groups become attributes,
   * which is how `Card declined for order 4821` yields `order_id`.
   */
  events?: { match: string; event: string }[];
  /** Source for lines that name none; the `--source` flag and the file name come after it. */
  source?: string;
  /** Zone of timestamps written without one: `UTC` (the default), `Z` or an offset like `+02:00`. */
  timezone?: string;
}

export interface TextOptions {
  format?: TextFormat;
  /** Source for lines that name none, normally taken from the file name (`payments-api.log`). */
  defaultSource?: string;
}

const KNOWN_KEYS = new Set(["pattern", "events", "source", "timezone"]);
const TIMESTAMP = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,](\d{1,9}))?[ ]?(Z|[+-]\d{2}:?\d{2})?/;
const LEADING_TIMESTAMP = new RegExp(`^\\s*\\[?${TIMESTAMP.source}\\]?`);
const LEVEL = /^[\s:|-]*\[?(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL)\]?[\s:|-]*/i;
const PAIR = /(?:^|\s)([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g;

/** Validates a parsed log-format file; throws an Error that says what is wrong. */
export function readLogFormat(data: unknown): TextFormat {
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("the log format must be an object");
  const format = data as Record<string, unknown>;
  for (const key of Object.keys(format)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`unknown property "${key}" in the log format (expected pattern, events, source, timezone)`);
  }
  const result: TextFormat = {};
  if (format.pattern !== undefined) {
    if (typeof format.pattern !== "string") throw new Error("log format: pattern must be a string");
    compile(format.pattern, "pattern");
    result.pattern = format.pattern;
  }
  if (format.events !== undefined) {
    if (!Array.isArray(format.events)) throw new Error("log format: events must be a list of { match, event }");
    result.events = format.events.map((rule: unknown, index) => {
      const entry = rule as { match?: unknown; event?: unknown };
      if (typeof entry?.match !== "string" || typeof entry.event !== "string" || entry.event === "") {
        throw new Error(`log format: events[${index}] needs a "match" regex and an "event" name`);
      }
      compile(entry.match, `events[${index}].match`);
      return { match: entry.match, event: entry.event };
    });
  }
  if (format.source !== undefined) {
    if (typeof format.source !== "string" || format.source === "") throw new Error("log format: source must be a non-empty string");
    result.source = format.source;
  }
  if (format.timezone !== undefined) {
    if (typeof format.timezone !== "string" || zoneOf(format.timezone) === undefined) {
      throw new Error('log format: timezone must be "UTC", "Z" or an offset like "+02:00"');
    }
    result.timezone = format.timezone;
  }
  return result;
}

function compile(source: string, where: string): RegExp {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(`log format: ${where} is not a valid regular expression: ${(error as Error).message}`);
  }
}

function zoneOf(text: string): string | undefined {
  if (text === "UTC" || text === "Z") return "Z";
  const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  return offset === null ? undefined : `${offset[1]}${offset[2]}:${offset[3]}`;
}

interface Stamp {
  ts: string;
  /** The text after the timestamp. */
  rest: string;
  assumed: boolean;
}

/** Reads a timestamp at the start of `text`, normalised to ISO 8601 with a zone. */
function leadingStamp(text: string, zone: string): Stamp | undefined {
  const match = LEADING_TIMESTAMP.exec(text);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const own = match[4] === undefined ? undefined : zoneOf(match[4]);
  return {
    ts: `${match[1]}T${match[2]}${match[3] === undefined ? "" : `.${match[3]}`}${own ?? zone}`,
    rest: text.slice(match[0].length),
    assumed: own === undefined,
  };
}

/** Same for text that should be nothing but a timestamp (a `ts` group, a `ts=` pair). */
function wholeStamp(text: string, zone: string): Stamp | undefined {
  const trimmed = text.trim();
  if (/^\d{10}(\d{3})?$/.test(trimmed)) {
    return { ts: new Date(trimmed.length === 10 ? Number(trimmed) * 1000 : Number(trimmed)).toISOString(), rest: "", assumed: false };
  }
  const stamp = leadingStamp(trimmed, zone);
  return stamp !== undefined && stamp.rest.trim() === "" ? stamp : undefined;
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1);
  }
}

/** logfmt-style `key=value` pairs, and the text left when they are removed. */
function pairsOf(text: string): { pairs: Record<string, string>; rest: string } {
  const pairs: Record<string, string> = {};
  const rest = text.replace(PAIR, (whole, key: string, value: string) => {
    pairs[key] = unquote(value);
    return whole.startsWith(" ") || /^\s/.test(whole) ? " " : "";
  });
  return { pairs, rest: rest.replace(LEVEL, " ").replace(/\s+/g, " ").trim() };
}

/**
 * Reads events out of a plain-text log. Per line, the first reader that
 * understands it wins:
 *
 * 1. a JSON object, alone or after a timestamp and level (`2026-10-31T09:00:00Z INFO {"event":...}`);
 * 2. the `pattern` from the log format, if one is given;
 * 3. a timestamp followed by `key=value` pairs and a message, where an `event=`
 *    pair (or an `events` rule matching the message) names the event.
 *
 * The source is the line's `source=`/`service=`, else the format's `source`, else
 * `defaultSource`. Lines that yield no event (continuation lines, noise) are not
 * errors: they are counted in one warning per file. The ref is `file://<name>#L<line>`
 * and the line itself is kept as `raw`.
 */
export function parseLogText(text: string, name: string, options: TextOptions = {}): AdapterResult {
  const format = options.format ?? {};
  const zone = zoneOf(format.timezone ?? "UTC") ?? "Z";
  const pattern = format.pattern === undefined ? undefined : compile(format.pattern, "pattern");
  const rules = (format.events ?? []).map((rule) => ({ regex: compile(rule.match, "events"), event: rule.event }));
  const defaultSource = format.source ?? options.defaultSource;

  const events: LogEvent[] = [];
  let ignored = 0;
  let firstIgnored: { line: number; reason: string } | undefined;
  let assumedZone = false;

  text.replace(/^﻿/, "").split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const number = index + 1;
    const ref = `file://${encodeURI(name)}#L${number}`;
    const raw = capRaw(line);
    const defaults = { ...(defaultSource === undefined ? {} : { source: defaultSource }), raw };

    const lead = leadingStamp(line, zone);
    const result = readLine(line, lead, pattern, rules, zone, defaults, ref);
    if ("event" in result) {
      events.push(result.event);
      if (result.assumed) assumedZone = true;
    } else {
      ignored += 1;
      firstIgnored ??= { line: number, reason: result.reason };
    }
  });

  const warnings: string[] = [];
  if (ignored > 0 && firstIgnored !== undefined) {
    warnings.push(
      `${name}: ${ignored} line${ignored === 1 ? "" : "s"} carried no usable event and ${ignored === 1 ? "was" : "were"} ignored (first: line ${firstIgnored.line}, ${firstIgnored.reason})`,
    );
  }
  if (assumedZone && format.timezone === undefined) {
    warnings.push(`${name}: some timestamps have no time zone; assumed ${zone === "Z" ? "UTC" : zone} (set "timezone" in the log format to change it)`);
  }
  return { events, warnings };
}

type LineResult = { event: LogEvent; assumed: boolean } | { reason: string };

function readLine(
  line: string,
  lead: Stamp | undefined,
  pattern: RegExp | undefined,
  rules: { regex: RegExp; event: string }[],
  zone: string,
  defaults: { source?: string; raw: string },
  ref: string,
): LineResult {
  // 1. JSON, possibly after a timestamp and level.
  const brace = line.indexOf("{");
  if (brace !== -1) {
    const before = brace === 0 ? "" : (lead === undefined ? line.slice(0, brace) : lead.rest.slice(0, brace - (line.length - lead.rest.length)));
    if (before.replace(LEVEL, "").replace(/[\s:|-]/g, "") === "") {
      try {
        const record: unknown = JSON.parse(line.slice(brace));
        if (typeof record === "object" && record !== null && !Array.isArray(record)) {
          const result = normaliseRecord(record, ref, { ...defaults, ...(lead === undefined ? {} : { ts: lead.ts }) });
          return "event" in result ? { event: result.event, assumed: lead?.assumed === true && (record as Record<string, unknown>).ts === undefined } : result;
        }
      } catch {
        // not JSON after all: fall through to the text readers
      }
    }
  }

  // 2. The user's pattern, else 3. a timestamp followed by key=value pairs.
  const fields: Record<string, unknown> = {};
  let stamp = lead;
  let message: string;
  if (pattern !== undefined) {
    const groups = pattern.exec(line)?.groups;
    if (groups === undefined) return { reason: "does not match the log format pattern" };
    for (const [key, value] of Object.entries(groups)) if (value !== undefined) fields[key] = value;
    stamp = typeof fields.ts === "string" ? wholeStamp(fields.ts, zone) : undefined;
    if (stamp === undefined) return { reason: typeof fields.ts === "string" ? `unrecognised timestamp ${JSON.stringify(fields.ts)}` : "the pattern has no ts group" };
    message = typeof fields.msg === "string" ? fields.msg : line;
  } else {
    if (stamp === undefined) return { reason: "no timestamp at the start of the line" };
    message = stamp.rest;
  }

  const { pairs, rest } = pairsOf(message);
  for (const [key, value] of Object.entries(pairs)) if (!(key in fields)) fields[key] = value;
  if (fields.msg === undefined && rest !== "") fields.msg = rest;
  if (fields.event === undefined) {
    const searched = typeof fields.msg === "string" ? fields.msg : message;
    for (const rule of rules) {
      const found = rule.regex.exec(searched);
      if (found === null) continue;
      fields.event = rule.event;
      for (const [key, value] of Object.entries(found.groups ?? {})) if (value !== undefined && !(key in fields)) fields[key] = value;
      break;
    }
  }

  const assumed = stamp.assumed;
  fields.ts = stamp.ts;
  const attributeKeys = Object.keys(fields).filter((key) => !["ts", "source", "service", "service_name", "event", "event_name", "msg", "message"].includes(key));
  const record: Record<string, unknown> = {
    ts: stamp.ts,
    ...(fields.source === undefined && fields.service === undefined ? {} : { source: fields.source ?? fields.service }),
    ...(fields.event === undefined ? {} : { event: fields.event }),
    ...(fields.msg === undefined ? {} : { msg: fields.msg }),
    attributes: Object.fromEntries(attributeKeys.map((key) => [key, fields[key]])),
  };
  const result = normaliseRecord(record, ref, defaults);
  if (!("event" in result)) {
    return result.reason.startsWith("no event name")
      ? { reason: "no event name (add event=<name> to the line, or an events rule in the log format)" }
      : result;
  }
  return { event: result.event, assumed };
}
