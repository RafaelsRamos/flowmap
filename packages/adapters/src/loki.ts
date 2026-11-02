import type { LogEvent } from "@flowmap/core";
import { normaliseRecord } from "./normalise.js";
import type { AdapterResult, LogAdapter, LogQuery } from "./types.js";

export interface LokiOptions {
  /** Base URL of Loki (or its gateway), e.g. `https://loki.example.com`. */
  url: string;
  /** Stream label that holds the log source, matched against `evidence.source`. Default `service`. */
  sourceLabel?: string;
  /** Sent as `X-Scope-OrgID` for multi-tenant Loki. */
  tenant?: string;
  bearerToken?: string;
  basicAuth?: { user: string; password: string };
  /** Lines per request; Loki servers usually cap this at 5000. */
  limit?: number;
  /** Stop after this many requests and warn that the result is truncated. */
  maxPages?: number;
  fetch?: typeof fetch;
}

interface Streams {
  status?: string;
  data?: { result?: { stream?: Record<string, string>; values?: [string, string][] }[] };
}

/**
 * Reads log lines from Loki's `query_range` API. The lines must be JSON objects
 * carrying an event name (`{"event":"payment.declined",...}`); the source comes
 * from the line or, failing that, from the stream label. Credentials stay in
 * this process: they are passed in by the caller and never put in a `ref`.
 */
export function lokiAdapter(options: LokiOptions): LogAdapter {
  const label = options.sourceLabel ?? "service";
  const limit = options.limit ?? 5000;
  const maxPages = options.maxPages ?? 20;
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, "");

  return {
    name: "loki",
    async fetch(query: LogQuery): Promise<AdapterResult> {
      if (query.from === undefined || query.to === undefined) {
        throw new Error("Loki needs a time window: pass --from (and optionally --to)");
      }
      const logql = buildLogql(label, query);
      const events: LogEvent[] = [];
      const warnings: string[] = [];
      let notJson = 0;
      let start = toNanos(query.from);
      const end = toNanos(query.to);

      for (let page = 1; ; page += 1) {
        const url = `${base}/loki/api/v1/query_range?${new URLSearchParams({
          query: logql,
          start: start.toString(),
          end: end.toString(),
          limit: String(limit),
          direction: "forward",
        })}`;
        const response = await doFetch(url, { headers: headers(options) });
        if (!response.ok) {
          const body = (await response.text()).slice(0, 200).replace(/\s+/g, " ");
          throw new Error(`Loki answered ${response.status} ${response.statusText}: ${body}`);
        }
        const payload = (await response.json()) as Streams;
        let received = 0;
        let newest = start;
        for (const stream of payload.data?.result ?? []) {
          const source = stream.stream?.[label];
          for (const [nanos, line] of stream.values ?? []) {
            received += 1;
            const at = BigInt(nanos);
            if (at > newest) newest = at;
            let record: unknown;
            try {
              record = JSON.parse(line);
            } catch {
              notJson += 1;
              continue;
            }
            const ref = `loki://${encodeURIComponent(source ?? "unknown")}?ts=${nanos}`;
            const result = normaliseRecord(record, ref, { ...(source === undefined ? {} : { source }), ts: nanosToIso(at), raw: line });
            if ("event" in result) events.push(result.event);
            else warnings.push(`loki ${ref}: skipped, ${result.reason}`);
          }
        }
        if (received < limit) break;
        if (page >= maxPages) {
          warnings.push(`stopped after ${maxPages} pages of ${limit} lines; the trace may be incomplete (narrow --from/--to)`);
          break;
        }
        start = newest + 1n;
      }
      if (notJson > 0) warnings.push(`${notJson} Loki line${notJson === 1 ? "" : "s"} skipped: not JSON objects, so they carry no event name`);
      return { events, warnings };
    },
  };
}

/** `{service=~"a|b"} |= "4821"`: the sources of the flow, narrowed to lines that mention the instance. */
export function buildLogql(label: string, query: LogQuery): string {
  const sources = query.sources.map((source) => source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const selector = sources === "" ? `{${label}=~".+"}` : `{${label}=~${JSON.stringify(sources)}}`;
  return `${selector} |= ${JSON.stringify(query.correlationValue)}`;
}

function headers(options: LokiOptions): Record<string, string> {
  const result: Record<string, string> = { Accept: "application/json" };
  if (options.tenant !== undefined) result["X-Scope-OrgID"] = options.tenant;
  if (options.bearerToken !== undefined) result.Authorization = `Bearer ${options.bearerToken}`;
  else if (options.basicAuth !== undefined) {
    const bytes = new TextEncoder().encode(`${options.basicAuth.user}:${options.basicAuth.password}`);
    result.Authorization = `Basic ${btoa(String.fromCharCode(...bytes))}`;
  }
  return result;
}

function toNanos(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000_000n;
}

/** Nanosecond epoch to ISO 8601 UTC, keeping the sub-millisecond digits. */
function nanosToIso(nanos: bigint): string {
  const millis = nanos / 1_000_000n;
  const rest = (nanos % 1_000_000n).toString().padStart(6, "0");
  return new Date(Number(millis)).toISOString().replace(/Z$/, `${rest}Z`);
}
