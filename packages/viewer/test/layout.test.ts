import { describe, expect, it } from "vitest";
import { exampleFiles } from "../src/lib/example.js";
import { buildGraph } from "../src/lib/graph.js";
import { layoutGraph } from "../src/lib/layout.js";
import { buildWorkspace } from "../src/lib/workspace.js";

const workspace = buildWorkspace(exampleFiles());
const flow = workspace.flows[0]?.flow;
const run = workspace.runs.find((r) => r.run.correlation.orderId === "4823")?.run;
if (!flow) throw new Error("example flow missing");

async function positionsFor(expanded: string[]) {
  const graph = buildGraph(flow as NonNullable<typeof flow>, run, new Set(expanded));
  const positions = await layoutGraph(
    graph.nodes.map((n) => ({ id: n.id, width: n.data.width, height: n.data.height })),
    graph.edges,
  );
  return { graph, positions };
}

describe("layoutGraph", () => {
  it("places every node, with the flow running downwards", async () => {
    const { graph, positions } = await positionsFor([]);
    expect([...positions.keys()].sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    const y = (id: string) => positions.get(id)?.y ?? NaN;
    expect(y("order-placed")).toBeLessThan(y("payment"));
    expect(y("payment")).toBeLessThan(y("pick-pack"));
    expect(y("pick-pack")).toBeLessThan(y("out-for-delivery"));
    expect(y("out-for-delivery")).toBeLessThan(y("delivered"));
  });

  it("never overlaps nodes, even with Payment expanded", async () => {
    const { graph, positions } = await positionsFor(["payment"]);
    const boxes = graph.nodes.map((n) => ({ id: n.id, ...(positions.get(n.id) ?? { x: 0, y: 0 }), w: n.data.width, h: n.data.height }));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id >= b.id) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });

  it("leaves room beside nodes for their self-loops", async () => {
    const { positions } = await positionsFor([]);
    const payment = positions.get("payment");
    const stock = positions.get("stock-check");
    // Payment's retry loop bulges to its right; nothing may sit within the loop's reach.
    for (const [id, position] of positions) {
      if (id === "payment" || position.y !== payment?.y) continue;
      expect(Math.abs(position.x - (payment?.x ?? 0))).toBeGreaterThan(240 + 60);
    }
    expect(stock).toBeDefined();
  });
});
