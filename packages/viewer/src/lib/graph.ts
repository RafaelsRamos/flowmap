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
// These mirror the card's CSS (styles.css, .step): 1.5px borders, 10px padding, a 36px header, then the
// body with a 10px gap, a 1px rule and 8px padding, rows of 20px with 2px between them, and 8px under the fields.
const HEADER_HEIGHT = 59;
const BODY_TOP = 19;
const ROW_HEIGHT = 20;
const ROW_GAP = 2;
const FIELDS_BOTTOM = 8;
/** The "no evidence" note shown in an expanded card without fields or timeline. */
const EMPTY_BODY = 20;

const rows = (count: number): number => (count === 0 ? 0 : count * ROW_HEIGHT + (count - 1) * ROW_GAP);

/** Height of a node card: compact, or expanded to show fields and the evidence timeline, no taller than its content. */
export function nodeSize(run: RunNode | undefined, expanded: boolean): { width: number; height: number } {
  if (!expanded) return { width: NODE_WIDTH, height: HEADER_HEIGHT };
  const fields = Object.keys(run?.fields ?? {}).length;
  const evidence = run?.evidence?.length ?? 0;
  const content = fields === 0 && evidence === 0 ? EMPTY_BODY : rows(fields) + (fields > 0 && evidence > 0 ? FIELDS_BOTTOM : 0) + rows(evidence);
  return { width: EXPANDED_WIDTH, height: HEADER_HEIGHT + BODY_TOP + content };
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
