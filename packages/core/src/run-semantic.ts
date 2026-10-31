import type { Flow, Issue, PathSegment, Run } from "./types.js";
import type { Locate } from "./parse.js";
import { formatPath } from "./structure.js";

/**
 * Checks that a structurally valid run document is coherent on its own and,
 * when the flow it was matched against is given, consistent with that flow.
 * With a mismatched flow name nothing else is compared: every finding after
 * that would only describe the wrong file.
 */
export function validateRunSemantics(run: Run, locate: Locate, flow?: Flow): Issue[] {
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

  for (const [id, node] of Object.entries(run.nodes)) {
    const evidence = node.evidence ?? [];
    if (node.status === "not_reached" && evidence.length > 0) {
      report(
        "error",
        "status-evidence-mismatch",
        `node "${id}" is not_reached but has ${evidence.length} evidence entr${evidence.length === 1 ? "y" : "ies"}`,
        ["nodes", id, "status"],
      );
    }
    for (let i = 1; i < evidence.length; i += 1) {
      const previous = Date.parse(evidence[i - 1]?.ts ?? "");
      const current = Date.parse(evidence[i]?.ts ?? "");
      if (current < previous) {
        report(
          "warning",
          "evidence-out-of-order",
          `nodes.${id}.evidence[${i}] is earlier than the entry before it; evidence is listed oldest first`,
          ["nodes", id, "evidence", i, "ts"],
        );
      }
    }
  }

  if (flow === undefined) return issues;

  if (run.flow !== flow.flow) {
    report("error", "flow-mismatch", `run is for flow "${run.flow}" but was checked against flow "${flow.flow}"`, ["flow"]);
    return issues;
  }

  const declared = new Map(flow.nodes.map((node) => [node.id, node]));
  const unknown = (id: string): boolean => !declared.has(id);

  for (const id of Object.keys(run.nodes)) {
    if (unknown(id)) {
      report("error", "unknown-node", `nodes."${id}" is not a node of flow "${flow.flow}"`, ["nodes", id], true);
    }
  }
  for (const node of flow.nodes) {
    if (run.nodes[node.id] === undefined) {
      report("warning", "missing-node", `flow node "${node.id}" has no entry in nodes; it will be shown as not reached`, ["nodes"]);
    }
  }

  const matches = (from: string, to: string, label: string | undefined) =>
    flow.edges.some((edge) => edge.from === from && edge.to === to && (label === undefined || edge.label === label));

  run.edges.forEach((edge, index) => {
    let valid = true;
    for (const side of ["from", "to"] as const) {
      if (unknown(edge[side])) {
        valid = false;
        report("error", "unknown-node", `edges[${index}].${side} refers to unknown node "${edge[side]}"`, ["edges", index, side]);
      }
    }
    if (valid && !matches(edge.from, edge.to, edge.label)) {
      report(
        "error",
        "undeclared-edge",
        `edges[${index}] ${edge.from} -> ${edge.to}${edge.label === undefined ? "" : ` (${edge.label})`} is not declared by the flow; report it under unexpected instead`,
        ["edges", index],
      );
    }
  });

  run.unexpected.forEach((edge, index) => {
    let valid = true;
    for (const side of ["from", "to"] as const) {
      if (unknown(edge[side])) {
        valid = false;
        report("error", "unknown-node", `unexpected[${index}].${side} refers to unknown node "${edge[side]}"`, ["unexpected", index, side]);
      }
    }
    if (valid && matches(edge.from, edge.to, undefined)) {
      report(
        "error",
        "declared-edge-unexpected",
        `unexpected[${index}] ${edge.from} -> ${edge.to} is declared by the flow; report it under edges instead`,
        ["unexpected", index],
      );
    }
  });

  for (const [id, node] of Object.entries(run.nodes)) {
    const matched = declared.get(id)?.evidence?.match.event;
    if (matched === undefined) continue;
    (node.evidence ?? []).forEach((entry, index) => {
      if (!matched.includes(entry.event)) {
        report(
          "warning",
          "evidence-event-not-matched",
          `nodes.${id}.evidence[${index}] has event "${entry.event}", which the flow does not list in match.event for this node`,
          ["nodes", id, "evidence", index, "event"],
        );
      }
    });
  }

  return issues;
}
