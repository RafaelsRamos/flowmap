import type { Flow, LogEvent } from "@flowmap/core";

/** What the matching engine needs from a backend, derived from the flow. */
export interface LogQuery {
  /** Log sources of the flow's nodes; a backend may use them to narrow its search. */
  sources: string[];
  correlationKey: string;
  correlationValue: string;
  /** Where the key sits in an event (`attributes.order_id`); a backend may use the paths to pre-filter. */
  correlatePaths: string[];
  /** Search window; a backend that needs one (Loki) refuses to run without it. */
  from?: Date;
  to?: Date;
}

/** Records an adapter could not turn into events: reported, never silently dropped. */
export interface AdapterResult {
  events: LogEvent[];
  warnings: string[];
}

/**
 * One log backend. The engine in core only ever sees the events it returns, so
 * adding a backend never touches core. Returning more events than needed is
 * fine: the engine filters by source, event name and correlation value.
 */
export interface LogAdapter {
  readonly name: string;
  fetch(query: LogQuery): Promise<AdapterResult>;
}

export function buildQuery(flow: Flow, correlationValue: string, window: { from?: Date; to?: Date } = {}): LogQuery {
  const evidence = flow.nodes.flatMap((node) => (node.evidence === undefined ? [] : [node.evidence]));
  return {
    sources: [...new Set(evidence.map((e) => e.source))],
    correlationKey: flow.correlationKey,
    correlationValue,
    correlatePaths: [...new Set(evidence.map((e) => e.match.correlate))],
    ...window,
  };
}
