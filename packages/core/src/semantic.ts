import type { Flow, Issue, PathSegment } from "./types.js";
import type { Locate } from "./parse.js";
import { formatPath } from "./structure.js";

const COUNT_EXPRESSION = /^count\((.+)\)$/;

/**
 * Checks that a structurally valid flow is also a sound graph: ids are unique,
 * edges point at real nodes, everything is reachable from the start, dead
 * ends are declared, and evidence rules refer to events that are matched.
 */
export function validateSemantics(flow: Flow, locate: Locate): Issue[] {
  const issues: Issue[] = [];
  const report = (
    severity: Issue["severity"],
    code: string,
    message: string,
    path: PathSegment[],
    key = false,
  ): void => {
    const where = locate(path, { key });
    issues.push({ severity, code, message, path: formatPath(path), line: where.line, column: where.column });
  };

  // Node ids: unique, and the basis for every reference below.
  const firstIndex = new Map<string, number>();
  flow.nodes.forEach((node, index) => {
    const earlier = firstIndex.get(node.id);
    if (earlier === undefined) {
      firstIndex.set(node.id, index);
    } else {
      report(
        "error",
        "duplicate-node-id",
        `node id "${node.id}" is already used by nodes[${earlier}]`,
        ["nodes", index, "id"],
      );
    }
  });
  const known = (id: string): boolean => firstIndex.has(id);

  if (!known(flow.start)) {
    report("error", "unknown-node", `start refers to unknown node "${flow.start}"`, ["start"]);
  }
  const endSeen = new Set<string>();
  flow.end.forEach((id, index) => {
    if (!known(id)) {
      report("error", "unknown-node", `end refers to unknown node "${id}"`, ["end", index]);
    } else if (endSeen.has(id)) {
      report("error", "duplicate-end", `node "${id}" is listed in end more than once`, ["end", index]);
    }
    endSeen.add(id);
  });

  // Edges: valid endpoints, no exact duplicates, trigger events that the source can emit.
  const adjacency = new Map<string, Set<string>>();
  const edgeKeys = new Map<string, number>();
  flow.edges.forEach((edge, index) => {
    let valid = true;
    for (const side of ["from", "to"] as const) {
      if (!known(edge[side])) {
        valid = false;
        report("error", "unknown-node", `edges[${index}].${side} refers to unknown node "${edge[side]}"`, [
          "edges",
          index,
          side,
        ]);
      }
    }
    if (!valid) return;

    const key = `${edge.from}\u0000${edge.to}\u0000${edge.when ?? ""}`;
    const earlier = edgeKeys.get(key);
    if (earlier !== undefined) {
      report(
        "warning",
        "duplicate-edge",
        `edge ${edge.from} -> ${edge.to}${edge.when ? ` (when ${edge.when})` : ""} repeats edges[${earlier}]`,
        ["edges", index],
      );
    } else {
      edgeKeys.set(key, index);
    }

    let targets = adjacency.get(edge.from);
    if (targets === undefined) {
      targets = new Set();
      adjacency.set(edge.from, targets);
    }
    targets.add(edge.to);

    const source = flow.nodes[firstIndex.get(edge.from)!];
    if (edge.when !== undefined && source?.evidence && !source.evidence.match.event.includes(edge.when)) {
      report(
        "warning",
        "edge-event-not-matched",
        `edge ${edge.from} -> ${edge.to} fires on "${edge.when}", which node "${edge.from}" does not match in evidence.match.event`,
        ["edges", index, "when"],
      );
    }
  });

  // Reachability from start.
  if (known(flow.start)) {
    const reached = new Set<string>([flow.start]);
    const queue = [flow.start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    flow.nodes.forEach((node, index) => {
      if (firstIndex.get(node.id) === index && !reached.has(node.id)) {
        report(
          "error",
          "unreachable-node",
          `node "${node.id}" is not reachable from start "${flow.start}"`,
          ["nodes", index, "id"],
        );
      }
    });
  }

  // Terminals: a node you can never leave must be declared in end, and end nodes should be final.
  flow.nodes.forEach((node, index) => {
    if (firstIndex.get(node.id) !== index) return;
    const exits = [...(adjacency.get(node.id) ?? [])].filter((target) => target !== node.id);
    const declared = endSeen.has(node.id);
    if (exits.length === 0 && !declared) {
      report(
        "error",
        "undeclared-terminal",
        `node "${node.id}" has no outgoing edge, so it must be listed in end (or given an edge out)`,
        ["nodes", index, "id"],
      );
    }
    if (exits.length > 0 && declared) {
      const position = flow.end.indexOf(node.id);
      report(
        "warning",
        "end-has-exits",
        `end node "${node.id}" has outgoing edges to ${exits.map((id) => `"${id}"`).join(", ")}; an instance reaching it is finished`,
        ["end", position],
      );
    }
  });

  // Evidence: outcome and display only refer to events the node actually matches.
  flow.nodes.forEach((node, index) => {
    const evidence = node.evidence;
    if (!evidence) return;
    const matched = new Set(evidence.match.event);

    for (const status of ["success", "failure"] as const) {
      const event = evidence.outcome?.[status];
      if (event !== undefined && !matched.has(event)) {
        report(
          "error",
          "outcome-event-not-matched",
          `node "${node.id}" outcome.${status} is "${event}", which is not in evidence.match.event`,
          ["nodes", index, "evidence", "outcome", status],
        );
      }
    }

    for (const [label, expression] of Object.entries(evidence.display ?? {})) {
      const event = COUNT_EXPRESSION.exec(expression)?.[1];
      if (event !== undefined && !matched.has(event)) {
        report(
          "error",
          "display-event-not-matched",
          `node "${node.id}" display "${label}" counts "${event}", which is not in evidence.match.event`,
          ["nodes", index, "evidence", "display", label],
        );
      }
    }
  });

  return issues;
}
