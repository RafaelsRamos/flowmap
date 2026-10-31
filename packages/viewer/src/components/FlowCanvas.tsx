import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import { useEffect } from "react";
import { FlowEdge, type FlowFlowEdge } from "./FlowEdge.js";
import { StepNode, type StepFlowNode } from "./StepNode.js";

const nodeTypes: NodeTypes = { step: StepNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

interface Props {
  /** Changing it re-fits the view: a different flow or run was laid out. */
  viewKey: string;
  nodes: StepFlowNode[];
  edges: FlowFlowEdge[];
  focus: { id: string; token: number } | undefined;
  onNodeClick: (id: string) => void;
  onBackgroundClick: () => void;
}

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ viewKey, nodes, edges, focus, onNodeClick, onBackgroundClick }: Props) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (focus === undefined) return;
    void fitView({ nodes: [{ id: focus.id }], duration: 350, maxZoom: 1.1, padding: 1.2 });
  }, [focus, fitView]);

  return (
    <ReactFlow
      key={viewKey}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: { top: "48px", left: "48px", bottom: "72px", right: "140px" }, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_event, node) => onNodeClick(node.id)}
      onPaneClick={onBackgroundClick}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
