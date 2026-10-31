import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { clockTime } from "../lib/overlay.js";
import type { StepData } from "../lib/graph.js";

export type StepNodeData = StepData & {
  dimmed: boolean;
  matched: boolean;
  selected: boolean;
  /** Set while picking a path: the ends are marked, the nodes between are tinted. */
  pathRole?: "from" | "to" | "on";
};

export type StepFlowNode = Node<StepNodeData, "step">;

const STATUS_LABEL: Record<StepData["status"], string> = {
  success: "Success",
  failure: "Failed",
  pending: "Pending",
  not_reached: "Not reached",
  none: "",
};

export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const { node, run, status, expanded, width, height } = data;
  const fields = Object.entries(run?.fields ?? {});
  const evidence = run?.evidence ?? [];

  const classes = [
    "step",
    `status-${status}`,
    expanded ? "expanded" : "",
    data.dimmed ? "dimmed" : "",
    data.matched ? "matched" : "",
    data.selected ? "selected" : "",
    data.pathRole ? `path-${data.pathRole}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ width, minHeight: height }} data-node-id={node.id}>
      <Handle type="target" position={Position.Top} id="in" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="loop-out" style={{ top: "30%" }} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="loop-in" style={{ top: "70%" }} isConnectable={false} />
      {/* Sideways links: transitions to a node that is not further down use the node sides. */}
      <Handle type="source" position={Position.Right} id="r-out" style={{ top: "50%" }} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="r-in" style={{ top: "50%" }} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="l-out" style={{ top: "50%" }} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="l-in" style={{ top: "50%" }} isConnectable={false} />

      <div className="step-head">
        <span className={`status-dot status-${status}`} title={STATUS_LABEL[status]} />
        <div className="step-title">
          <span className="step-label">{node.label}</span>
          {node.service && <span className="step-service">{node.service}</span>}
        </div>
        {status !== "none" && <span className="status-badge">{STATUS_LABEL[status]}</span>}
        {data.pathRole === "from" && <span className="role-badge">from</span>}
        {data.pathRole === "to" && <span className="role-badge">to</span>}
      </div>

      {expanded && (
        <div className="step-body">
          {fields.length > 0 && (
            <dl className="fields">
              {fields.map(([name, value]) => (
                <div key={name} className="field">
                  <dt>{name}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {evidence.length > 0 && (
            <ol className="timeline">
              {evidence.map((entry, index) => (
                <li key={`${entry.ts}-${index}`} title={`${entry.event} · ${entry.ts}`}>
                  <time>{clockTime(entry.ts)}</time>
                  <span>{entry.msg ?? entry.event}</span>
                </li>
              ))}
            </ol>
          )}
          {fields.length === 0 && evidence.length === 0 && (
            <p className="muted">{status === "none" ? "Load a run to see fields and evidence." : "No evidence for this step."}</p>
          )}
        </div>
      )}
    </div>
  );
}
