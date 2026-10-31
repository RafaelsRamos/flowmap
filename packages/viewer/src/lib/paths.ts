export interface PathEdge {
  from: string;
  to: string;
}

export interface PathResult {
  /** Each path is a list of indices into the edge list, in walking order. */
  paths: number[][];
  /** True when the search stopped at `limit` paths. */
  truncated: boolean;
}

/**
 * Every simple path (no node visited twice) from `start` to `end`. Self-loops
 * are ignored: a retry does not change which nodes a path goes through.
 * Parallel edges between the same nodes give separate paths. The search stops
 * after `limit` paths, because the number of paths can grow very quickly.
 */
export function findPaths(edges: readonly PathEdge[], start: string, end: string, limit = 200): PathResult {
  const paths: number[][] = [];
  if (start === end) return { paths, truncated: false };

  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    if (edge.from === edge.to) return;
    const list = outgoing.get(edge.from) ?? [];
    list.push(index);
    outgoing.set(edge.from, list);
  });

  const visited = new Set<string>([start]);
  const walk: number[] = [];
  let truncated = false;

  const visit = (node: string): void => {
    for (const index of outgoing.get(node) ?? []) {
      if (truncated) return;
      const edge = edges[index];
      if (edge === undefined || visited.has(edge.to)) continue;
      walk.push(index);
      if (edge.to === end) {
        if (paths.length >= limit) truncated = true;
        else paths.push([...walk]);
      } else {
        visited.add(edge.to);
        visit(edge.to);
        visited.delete(edge.to);
      }
      walk.pop();
    }
  };
  visit(start);
  return { paths, truncated };
}

/** The node ids a path goes through, in order. */
export function pathNodes(edges: readonly PathEdge[], path: readonly number[]): string[] {
  const first = edges[path[0] ?? -1];
  if (first === undefined) return [];
  return [first.from, ...path.map((index) => edges[index]?.to ?? "")];
}
