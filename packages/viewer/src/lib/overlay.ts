import type { Flow, Run } from "@flowmap/core";

/**
 * For each declared edge of the flow, how many times the run took it. A run
 * edge without a label counts toward the first declared edge between the same
 * nodes that has not been counted yet; one with a label must match it.
 */
export function observedCounts(flow: Flow, run: Run | undefined): number[] {
  const counts = flow.edges.map(() => 0);
  if (run === undefined) return counts;
  const claimed = new Set<number>();
  for (const seen of run.edges) {
    let index = flow.edges.findIndex((edge) => edge.from === seen.from && edge.to === seen.to && edge.label === seen.label && seen.label !== undefined);
    if (index === -1 && seen.label === undefined) {
      index = flow.edges.findIndex((edge, i) => edge.from === seen.from && edge.to === seen.to && !claimed.has(i));
    }
    if (index !== -1) {
      counts[index] = (counts[index] ?? 0) + seen.observed;
      claimed.add(index);
    }
  }
  return counts;
}

/** Hours and minutes as written in an ISO timestamp, e.g. `09:03`. Independent of the viewer's time zone. */
export function clockTime(ts: string): string {
  return ts.slice(11, 16);
}
