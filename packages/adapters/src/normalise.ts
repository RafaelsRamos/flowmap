import type { LogEvent } from "@flowmap/core";

export interface Defaults {
  /** Used when the record names no source, e.g. the Loki stream label. */
  source?: string;
  /** Used when the record carries no timestamp of its own. */
  ts?: string;
  /** The raw line, kept on the event so the evidence can show it. */
  raw?: string;
}

export type Normalised = { event: LogEvent } | { reason: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TS_KEYS = ["ts", "timestamp", "time", "@timestamp"];
const SOURCE_KEYS = ["source", "service", "service_name"];
const EVENT_KEYS = ["event", "event_name"];
const MSG_KEYS = ["msg", "message"];

/**
 * Turns one parsed log record into a normalised event, or says why it cannot.
 * The canonical record is `{ts, source, event, msg?, attributes?}`; a few common
 * aliases are accepted (`timestamp`, `service`, `message`...) and, when there is
 * no `attributes` object, every other field becomes an attribute.
 */
export function normaliseRecord(record: unknown, ref: string, defaults: Defaults = {}): Normalised {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return { reason: "not a JSON object" };
  }
  const fields = record as Record<string, unknown>;
  const consumed = new Set<string>();
  const take = (keys: string[]): unknown => {
    for (const key of keys) {
      if (fields[key] !== undefined) {
        consumed.add(key);
        return fields[key];
      }
    }
    return undefined;
  };

  const rawTs = take(TS_KEYS);
  const ts = rawTs === undefined ? defaults.ts : toTimestamp(rawTs);
  if (ts === undefined) return { reason: rawTs === undefined ? "no timestamp" : `unrecognised timestamp ${JSON.stringify(rawTs)}` };

  const rawSource = take(SOURCE_KEYS) ?? defaults.source;
  if (typeof rawSource !== "string" || rawSource === "") return { reason: "no source (expected a source or service field)" };

  const rawEvent = take(EVENT_KEYS);
  if (typeof rawEvent !== "string" || rawEvent === "") return { reason: "no event name (expected an event field)" };

  const rawMsg = take(MSG_KEYS);

  let attributes: Record<string, unknown>;
  const nested = fields.attributes;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    attributes = nested as Record<string, unknown>;
  } else {
    consumed.add("attributes");
    attributes = Object.fromEntries(Object.entries(fields).filter(([key]) => !consumed.has(key)));
  }

  return {
    event: {
      ts,
      source: rawSource,
      event: rawEvent,
      attributes,
      ...(typeof rawMsg === "string" && rawMsg !== "" ? { msg: rawMsg } : {}),
      ref,
      ...(defaults.raw === undefined ? {} : { raw: capRaw(defaults.raw) }),
    },
  };
}

const MAX_RAW = 4000;

/** Evidence carries the raw line; an absurdly long one (a stack trace on one line) is cut. */
export function capRaw(line: string): string {
  const trimmed = line.replace(/\r$/, "");
  return trimmed.length > MAX_RAW ? `${trimmed.slice(0, MAX_RAW)}…` : trimmed;
}

/** ISO 8601 with a zone is kept as written; epoch numbers (seconds or milliseconds) are converted. */
function toTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") return TIMESTAMP.test(value) ? value : undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1e11 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}
