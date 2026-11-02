import { describe, expect, it } from "vitest";
import { validateFlowSource, validateRunSource, type Flow } from "@flowmap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, nodeSize, NODE_WIDTH } from "../src/lib/graph.js";
import { clockTime, observedCounts } from "../src/lib/overlay.js";

const root = join(import.meta.dirname, "../../../examples/order-fulfilment/flows");
const flow = validateFlowSource(readFileSync(join(root, "order-fulfilment.yml"), "utf8"), "f").flow as Flow;
const run = (name: string) => validateRunSource(readFileSync(join(root, `examples/${name}.run.json`), "utf8"), name, { flow }).run;

describe("observedCounts", () => {
  it("is all zeros without a run", () => {
    expect(observedCounts(flow, undefined)).toEqual(flow.edges.map(() => 0));
  });

  it("maps observed counts onto declared edges, loops included", () => {
    const counts = observedCounts(flow, run("order-4821"));
    expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(flow.edges[3]?.label).toBe("retry");
    expect(flow.edges[6]?.label).toBe("not home");
  });

  it("counts only the edges a stuck run took", () => {
    expect(observedCounts(flow, run("order-4822"))).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("counts repeated loops", () => {
    const counts = observedCounts(flow, run("order-4824"));
    expect(counts[3]).toBe(2); // retry
    expect(observedCounts(flow, run("order-4825"))[6]).toBe(2); // not home: three attempts, the last one not yet retried
  });

  it("tells parallel edges apart by label", () => {
    const parallel: Flow = {
      ...flow,
      edges: [
        { from: "payment", to: "pick-pack", label: "paid" },
        { from: "payment", to: "pick-pack", label: "manual" },
      ],
    };
    const base = run("order-4821");
    if (!base) throw new Error("fixture missing");
    const labelled = { ...base, edges: [{ from: "payment", to: "pick-pack", label: "manual", observed: 2 }] };
    expect(observedCounts(parallel, labelled)).toEqual([0, 2]);
    const unlabelled = { ...base, edges: [{ from: "payment", to: "pick-pack", observed: 1 }] };
    expect(observedCounts(parallel, unlabelled)).toEqual([1, 0]);
  });
});

describe("clockTime", () => {
  it("reads the time as written, whatever the viewer's time zone", () => {
    expect(clockTime("2026-10-31T09:03:00Z")).toBe("09:03");
    expect(clockTime("2026-10-31T09:05:00+02:00")).toBe("09:05");
  });
});

describe("buildGraph", () => {
  it("overlays statuses, fields and evidence on the nodes", () => {
    const { nodes } = buildGraph(flow, run("order-4821"), new Set());
    const payment = nodes.find((node) => node.id === "payment")?.data;
    expect(payment?.status).toBe("success");
    expect(payment?.run?.fields).toEqual({ Status: "payment.approved", Amount: "€84.90", Attempts: 2 });
    expect(payment?.run?.evidence?.map((entry) => entry.msg)).toEqual(["Charging card", "Card declined", "Charging card", "Payment approved"]);
    expect(payment?.run?.evidence?.[1]?.raw).toContain("payment.declined");
    expect(nodes.find((node) => node.id === "order-placed")?.data.isStart).toBe(true);
    expect(nodes.find((node) => node.id === "delivered")?.data.isEnd).toBe(true);
  });

  it("has no status without a run, and not_reached for steps the run left out", () => {
    expect(buildGraph(flow, undefined, new Set()).nodes.every((node) => node.data.status === "none")).toBe(true);
    expect(buildGraph(flow, run("order-4822"), new Set()).nodes.find((node) => node.id === "delivered")?.data.status).toBe("not_reached");
  });

  it("flags self-loops and appends unexpected transitions as edges", () => {
    const { edges } = buildGraph(flow, run("order-4823"), new Set());
    expect(edges.filter((edge) => edge.data.selfLoop).map((edge) => edge.data.label)).toEqual(["retry", "not home"]);
    const unexpected = edges.filter((edge) => edge.data.kind === "unexpected");
    expect(unexpected.map((edge) => [edge.source, edge.target])).toEqual([["payment", "out-for-delivery"]]);
    expect(edges.find((edge) => edge.data.label === "retry")?.data.observed).toBe(0);
    expect(edges.find((edge) => edge.data.label === "not home")?.data.observed).toBe(0);
  });

  it("sizes an expanded card to its content: header + body, with no slack", () => {
    const payment = run("order-4821")?.nodes.payment; // 3 fields, 4 evidence entries
    const compact = nodeSize(payment, false);
    const open = nodeSize(payment, true);
    expect(compact).toEqual({ width: NODE_WIDTH, height: 59 });
    expect(open.height).toBe(59 + 19 + (3 * 20 + 2 * 2) + 8 + (4 * 20 + 3 * 2));
    expect(nodeSize({ status: "success" }, true).height).toBe(59 + 19 + 20);
    expect(nodeSize(undefined, true).height).toBeGreaterThan(compact.height);
  });
});
