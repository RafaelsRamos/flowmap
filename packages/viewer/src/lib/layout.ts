import ELK from "elkjs/lib/elk.bundled.js";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export type Position = { x: number; y: number };

const elk = new ELK();

/**
 * Layered auto-layout (top to bottom). Self-loops are left out: they are drawn
 * beside their node, so the layout only needs to leave room for them, which
 * the generous spacing between nodes in a layer does.
 */
export async function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[]): Promise<Map<string, Position>> {
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "110",
      "elk.layered.spacing.nodeNodeBetweenLayers": "76",
      "elk.layered.spacing.edgeNodeBetweenLayers": "30",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    edges: edges
      .filter((edge) => edge.source !== edge.target)
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const positions = new Map<string, Position>();
  for (const child of result.children ?? []) positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  return positions;
}
