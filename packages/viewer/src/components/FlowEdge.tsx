import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { EdgeData } from "../lib/graph.js";

export type FlowEdgeData = EdgeData & { dimmed: boolean; highlighted: boolean };
export type FlowFlowEdge = Edge<FlowEdgeData, "flow">;

const LOOP_BULGE = 64;

/**
 * A transition. Self-loops (retry, not home) have no distance between their
 * ends, so they are drawn as an arc out of the node's right side instead.
 */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<FlowFlowEdge>) {
  if (data === undefined) return null;

  let path: string;
  let labelX: number;
  let labelY: number;
  if (data.selfLoop) {
    path = `M ${sourceX} ${sourceY} C ${sourceX + LOOP_BULGE} ${sourceY - 6}, ${targetX + LOOP_BULGE} ${targetY + 6}, ${targetX} ${targetY}`;
    labelX = sourceX + LOOP_BULGE * 0.75 + 4;
    labelY = (sourceY + targetY) / 2;
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }

  const classes = [
    "edge",
    data.kind,
    data.observed === undefined ? "" : data.observed > 0 ? "taken" : "untaken",
    data.highlighted ? "highlighted" : "",
    data.dimmed ? "dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const showCount = data.observed !== undefined && data.observed > 0 && data.kind === "declared";
  return (
    <g className={classes}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="edge-path" />
      {(data.label || showCount) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${classes}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
            {showCount && <b> ×{data.observed}</b>}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
