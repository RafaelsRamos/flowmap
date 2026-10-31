import type { Flow, FlowNode, Run, RunNode, RunStatus } from "@flowmap/core";
import { observedCounts } from "./overlay.js";

/** What the viewer knows about a node: its place in the flow and, with a run, what happened. */
export type StepData = {
  node: FlowNode;
  /** Absent when no run is loaded. */
  run?: RunNode;
  status: RunStatus | "none";
  isStart: boolean;
  isEnd: boolean;
  expanded: boolean;
  width: number;
  height: number;
};

export type EdgeKind = "declared" | "unexpected";

export type EdgeData = {
  kind: EdgeKind;
  label?: string;
  /** Times the loaded run took this edge; undefined without a run. */
  observed?: number;
  selfLoop: boolean;
  /** Index into `flow.edges` for declared edges. */
  flowIndex?: number;
};

export interface GraphNode {
  id: string;
  data: StepData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  data: EdgeData;
}

export const NODE_WIDTH = 240;
export const EXPANDED_WIDTH = 288;
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 22;
const SECTION_GAP = 26;

/** Height of a node card: compact, or expanded to show fields and the evidence timeline. */
export function nodeSize(run: RunNode | undefined, expanded: boolean): { width: number; height: number } {
  if (!expanded) return { width: NODE_WIDTH, height: HEADER_HEIGHT };
  const fields = Object.keys(run?.fields ?? {}).length;
  const evidence = run?.evidence?.length ?? 0;
  const body =
    (fields > 0 ? SECTION_GAP + fields * ROW_HEIGHT : 0) + (evidence > 0 ? SECTION_GAP + evidence * ROW_HEIGHT : 0);
  return { width: EXPANDED_WIDTH, height: HEADER_HEIGHT + Math.max(body, 16) + 12 };
}

export function buildGraph(
  flow: Flow,
  run: Run | undefined,
  expanded: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = flow.nodes.map((node): GraphNode => {
    const runNode = run?.nodes[node.id];
    const isExpanded = expanded.has(node.id);
    return {
      id: node.id,
      data: {
        node,
        run: runNode,
        status: run === undefined ? "none" : (runNode?.status ?? "not_reached"),
        isStart: flow.start === node.id,
        isEnd: flow.end.includes(node.id),
        expanded: isExpanded,
        ...nodeSize(runNode, isExpanded),
      },
    };
  });

  const counts = observedCounts(flow, run);
  const edges = flow.edges.map(
    (edge, index): GraphEdge => ({
      id: `e${index}`,
      source: edge.from,
      target: edge.to,
      data: {
        kind: "declared",
        label: edge.label,
        observed: run === undefined ? undefined : counts[index],
        selfLoop: edge.from === edge.to,
        flowIndex: index,
      },
    }),
  );

  (run?.unexpected ?? []).forEach((edge, index) => {
    edges.push({
      id: `u${index}`,
      source: edge.from,
      target: edge.to,
      data: { kind: "unexpected", label: "unexpected", observed: 1, selfLoop: edge.from === edge.to },
    });
  });

  return { nodes, edges };
}
