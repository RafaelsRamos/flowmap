import type { LogEvent } from "./events.js";
import { evaluateDisplay, readPath } from "./expression.js";
import type { EvidenceEntry, Flow, FlowEdge, FlowNode, ObservedEdge, Run, RunNode, RunStatus, UnexpectedEdge } from "./types.js";

export interface MatchInput {
  flow: Flow;
  /** Candidate events, in any order; events of other instances and other sources are ignored. */
  events: readonly LogEvent[];
  /** The value of the flow's `correlationKey` that identifies the instance, e.g. `4821`. */
  correlationValue: string;
  /** Passed in, never read from a clock: the engine is a pure function. */
  generatedAt: string;
  flowRevision?: string;
}

/** A matched event and where it falls in the instance's time order. */
interface Hit {
  position: number;
  event: LogEvent;
}

/**
 * Turns a flow and the log events of one instance into a run document. No I/O,
 * no clock, no AI: the same input always gives the same document. See
 * docs/matching.md for the rules in prose.
 */
export function matchRun(input: MatchInput): Run {
  const { flow, correlationValue } = input;
  const ordered = orderEvents(input.events);

  // Assign events to nodes by source, event name and correlation value. One
  // event can serve several nodes (two nodes may share a source and an event).
  const hits = new Map<string, Hit[]>();
  const nodesAt = new Map<number, string[]>();
  for (const node of flow.nodes) {
    const nodeHits = node.evidence === undefined ? [] : hitsFor(node, ordered, correlationValue);
    hits.set(node.id, nodeHits);
    for (const hit of nodeHits) nodesAt.set(hit.position, [...(nodesAt.get(hit.position) ?? []), node.id]);
  }
  const hitsOf = (id: string): Hit[] => hits.get(id) ?? [];

  /** Events at the edge's source that can trigger it: its `when`, or any event when it has none. */
  const departures = (edge: FlowEdge): Hit[] =>
    hitsOf(edge.from).filter((hit) => edge.when === undefined || hit.event.event === edge.when);

  const edges: ObservedEdge[] = [];
  for (const edge of flow.edges) {
    const observed = countTraversals(edge, departures(edge), hitsOf(edge.to));
    if (observed > 0) {
      edges.push({ from: edge.from, to: edge.to, ...(edge.label === undefined ? {} : { label: edge.label }), observed });
    }
  }

  const declaredPair = (from: string, to: string): boolean => flow.edges.some((edge) => edge.from === from && edge.to === to);
  const unexpected: UnexpectedEdge[] = [];
  for (const node of flow.nodes) {
    const first = hitsOf(node.id)[0];
    if (first === undefined || node.id === flow.start) continue;
    const explained = flow.edges.some(
      (edge) => edge.to === node.id && edge.from !== node.id && departures(edge).some((d) => d.position <= first.position),
    );
    if (explained) continue;
    const from = nodeBefore(first.position, node.id, nodesAt);
    if (from === undefined || declaredPair(from, node.id)) continue;
    unexpected.push({ from, to: node.id, ts: first.event.ts, ref: first.event.ref });
  }
  unexpected.sort((a, b) => Date.parse(a.ts ?? "") - Date.parse(b.ts ?? ""));

  const nodes: Record<string, RunNode> = {};
  for (const node of flow.nodes) {
    const nodeHits = hitsOf(node.id);
    const armed = flow.edges.some((edge) => edge.to === node.id && edge.from !== node.id && departures(edge).length > 0);
    const status = nodeStatus(node, nodeHits, armed);
    const entry: RunNode = { status };
    if (nodeHits.length > 0) {
      const display = node.evidence?.display;
      if (display !== undefined) entry.fields = evaluateDisplay(display, nodeHits.map((hit) => hit.event));
      entry.evidence = nodeHits.map(({ event }): EvidenceEntry => ({
        ts: event.ts,
        event: event.event,
        ...(event.msg === undefined ? {} : { msg: event.msg }),
        ref: event.ref,
      }));
    }
    nodes[node.id] = entry;
  }

  return {
    schemaVersion: 1,
    flow: flow.flow,
    ...(input.flowRevision === undefined ? {} : { flowRevision: input.flowRevision }),
    correlation: { [flow.correlationKey]: correlationValue },
    generatedAt: input.generatedAt,
    nodes,
    edges,
    unexpected,
  };
}

/** Oldest first; events with the same timestamp keep the order they were given in. */
function orderEvents(events: readonly LogEvent[]): LogEvent[] {
  const stamped = events.map((event, index) => {
    const time = Date.parse(event.ts);
    if (Number.isNaN(time)) throw new TypeError(`event ${index} (${event.event}) has an unparseable timestamp "${event.ts}"`);
    return { event, index, time };
  });
  stamped.sort((a, b) => a.time - b.time || a.index - b.index);
  return stamped.map((item) => item.event);
}

function hitsFor(node: FlowNode, ordered: readonly LogEvent[], correlationValue: string): Hit[] {
  const evidence = node.evidence;
  if (evidence === undefined) return [];
  const hits: Hit[] = [];
  ordered.forEach((event, position) => {
    if (event.source !== evidence.source || !evidence.match.event.includes(event.event)) return;
    const value = readPath(event, evidence.match.correlate);
    if ((typeof value === "string" || typeof value === "number") && String(value) === correlationValue) {
      hits.push({ position, event });
    }
  });
  return hits;
}

/**
 * How many times an edge was taken. A transition is a triggering event at the
 * source followed by an arrival at the target before the next trigger. A loop
 * on one node counts a trigger only when the node has a later event: the last
 * decline of a payment that gave up is not a retry.
 */
function countTraversals(edge: FlowEdge, departures: readonly Hit[], arrivals: readonly Hit[]): number {
  if (edge.from === edge.to) {
    return departures.filter((d) => arrivals.some((a) => a.position > d.position)).length;
  }
  let taken = 0;
  departures.forEach((d, index) => {
    const nextTrigger = departures[index + 1]?.position ?? Number.POSITIVE_INFINITY;
    if (arrivals.some((a) => a.position >= d.position && a.position < nextTrigger)) taken += 1;
  });
  return taken;
}

/** The node of the latest event before `position` that is not `except`, in flow order when an event serves several. */
function nodeBefore(position: number, except: string, nodesAt: ReadonlyMap<number, string[]>): string | undefined {
  for (let p = position - 1; p >= 0; p -= 1) {
    const found = nodesAt.get(p)?.find((id) => id !== except);
    if (found !== undefined) return found;
  }
  return undefined;
}

function nodeStatus(node: FlowNode, nodeHits: readonly Hit[], armed: boolean): RunStatus {
  if (node.evidence === undefined) return "not_reached";
  if (nodeHits.length === 0) return armed ? "pending" : "not_reached";
  const outcome = node.evidence.outcome;
  if (outcome === undefined) return "success";
  for (let i = nodeHits.length - 1; i >= 0; i -= 1) {
    const name = nodeHits[i]?.event.event;
    if (name !== undefined && name === outcome.failure) return "failure";
    if (name !== undefined && name === outcome.success) return "success";
  }
  return "pending";
}
