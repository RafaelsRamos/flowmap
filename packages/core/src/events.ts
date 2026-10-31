/**
 * One log line, normalised. Every adapter turns its backend's records into
 * this shape, so the matching engine never sees a backend-specific format.
 */
export interface LogEvent {
  /** When the event happened: ISO 8601 with a time zone (what the run schema requires). */
  ts: string;
  /** Which log source emitted it; compared with a node's `evidence.source`. */
  source: string;
  /** The event name, compared with `evidence.match.event`. */
  event: string;
  /** Everything else the line carried; `attributes.<name>` paths read from here. */
  attributes: Record<string, unknown>;
  /** A one-line human message, shown on the evidence timeline. */
  msg?: string;
  /** URI back to the raw log line, e.g. `file://orders.ndjson#L12` or `loki://payments-api?ts=...`. */
  ref: string;
}
