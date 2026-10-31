import { describe, expect, it } from "vitest";
import { evaluateExpression, matchRun, readPath, validateRunSource, type Flow, type LogEvent } from "../src/index.js";

const GENERATED_AT = "2026-10-31T16:30:00Z";

/** a -> b -> c, with a retry loop on b and an optional extra node. */
function flowOf(overrides: Partial<Flow> = {}): Flow {
  return {
    schemaVersion: 1,
    flow: "tiny",
    correlationKey: "orderId",
    start: "a",
    end: ["c"],
    nodes: [
      {
        id: "a",
        label: "A",
        evidence: { source: "svc-a", match: { event: ["a.done"], correlate: "attributes.order_id" }, outcome: { success: "a.done" } },
      },
      {
        id: "b",
        label: "B",
        evidence: {
          source: "svc-b",
          match: { event: ["b.try", "b.fail", "b.ok"], correlate: "attributes.order_id" },
          outcome: { success: "b.ok", failure: "b.fail" },
          display: { Status: "last(event)", Amount: "attributes.amount", First: "first(attributes.amount)", Tries: "count(b.try)" },
        },
      },
      {
        id: "c",
        label: "C",
        evidence: { source: "svc-c", match: { event: ["c.done"], correlate: "attributes.order_id" }, outcome: { success: "c.done" } },
      },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "b", label: "retry", when: "b.fail" },
      { from: "b", to: "c", label: "ok", when: "b.ok" },
    ],
    ...overrides,
  };
}

let counter = 0;
function ev(ts: string, source: string, event: string, attributes: Record<string, unknown> = {}, order: unknown = "1"): LogEvent {
  counter += 1;
  return { ts, source, event, attributes: { order_id: order, ...attributes }, ref: `file://t.ndjson#L${counter}` };
}

function run(events: LogEvent[], flow = flowOf()) {
  const result = matchRun({ flow, events, correlationValue: "1", generatedAt: GENERATED_AT });
  const checked = validateRunSource(JSON.stringify(result), "run", { flow });
  expect(checked.issues).toEqual([]);
  return result;
}

describe("matchRun", () => {
  it("produces the fixed run shape: every flow node, edges and unexpected always present", () => {
    const result = run([]);
    expect(result).toEqual({
      schemaVersion: 1,
      flow: "tiny",
      correlation: { orderId: "1" },
      generatedAt: GENERATED_AT,
      nodes: { a: { status: "not_reached" }, b: { status: "not_reached" }, c: { status: "not_reached" } },
      edges: [],
      unexpected: [],
    });
  });

  it("records flowRevision only when given", () => {
    const withRevision = matchRun({ flow: flowOf(), events: [], correlationValue: "1", generatedAt: GENERATED_AT, flowRevision: "git:abc" });
    expect(withRevision.flowRevision).toBe("git:abc");
  });

  it("ignores other instances, other sources and unlisted events", () => {
    const result = run([
      ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
      ev("2026-10-31T09:00:01Z", "svc-a", "a.done", {}, "2"),
      ev("2026-10-31T09:00:02Z", "svc-other", "b.ok"),
      ev("2026-10-31T09:00:03Z", "svc-b", "b.unrelated"),
      ev("2026-10-31T09:00:04Z", "svc-b", "b.ok", {}, 1),
    ]);
    expect(result.nodes.a?.evidence).toHaveLength(1);
    expect(result.nodes.b?.evidence?.map((e) => e.event)).toEqual(["b.ok"]);
  });

  it("orders by time whatever order events arrive in, ties keeping input order", () => {
    const late = ev("2026-10-31T09:05:00Z", "svc-b", "b.ok");
    const early = ev("2026-10-31T09:01:00Z", "svc-b", "b.fail");
    const tieFirst = ev("2026-10-31T09:03:00Z", "svc-b", "b.try");
    const tieSecond = ev("2026-10-31T09:03:00Z", "svc-b", "b.fail");
    const result = run([late, tieFirst, early, tieSecond]);
    expect(result.nodes.b?.evidence?.map((e) => e.ref)).toEqual([early.ref, tieFirst.ref, tieSecond.ref, late.ref]);
  });

  it("compares instants, not strings, so offsets order correctly", () => {
    const result = run([
      ev("2026-10-31T10:00:00+02:00", "svc-b", "b.ok"), // 08:00Z
      ev("2026-10-31T08:30:00Z", "svc-b", "b.fail"),
    ]);
    expect(result.nodes.b?.evidence?.map((e) => e.event)).toEqual(["b.ok", "b.fail"]);
  });

  it("matches a numeric correlation attribute against the string key", () => {
    const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done", {}, 1)]);
    expect(result.nodes.a?.status).toBe("success");
  });

  it("throws on an unparseable timestamp rather than guessing an order", () => {
    expect(() => run([ev("yesterday", "svc-a", "a.done")])).toThrow(/unparseable timestamp/);
  });

  it("is deterministic and leaves its input alone", () => {
    const events = [ev("2026-10-31T09:01:00Z", "svc-b", "b.ok"), ev("2026-10-31T09:00:00Z", "svc-a", "a.done")];
    const copy = structuredClone(events);
    expect(run(events)).toEqual(run(events));
    expect(events).toEqual(copy);
  });

  describe("edges", () => {
    it("counts a retry loop only when the node has a later event", () => {
      const result = run([
        ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
        ev("2026-10-31T09:01:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:02:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:03:00Z", "svc-b", "b.fail"),
      ]);
      expect(result.edges).toEqual([
        { from: "a", to: "b", observed: 1 },
        { from: "b", to: "b", label: "retry", observed: 2 },
      ]);
    });

    it("takes a conditional edge only when its `when` event is followed by an arrival", () => {
      const declined = run([
        ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
        ev("2026-10-31T09:01:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:02:00Z", "svc-c", "c.done"),
      ]);
      expect(declined.edges.map((e) => e.label ?? `${e.from}->${e.to}`)).toEqual(["a->b"]);
      expect(declined.unexpected).toEqual([]);
    });

    it("walks the happy path through a retry", () => {
      const result = run([
        ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
        ev("2026-10-31T09:01:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:02:00Z", "svc-b", "b.ok"),
        ev("2026-10-31T09:03:00Z", "svc-c", "c.done"),
      ]);
      expect(result.edges).toEqual([
        { from: "a", to: "b", observed: 1 },
        { from: "b", to: "b", label: "retry", observed: 1 },
        { from: "b", to: "c", label: "ok", observed: 1 },
      ]);
      expect(result.unexpected).toEqual([]);
    });

    it("lets one event serve two nodes that share a source", () => {
      const flow = flowOf();
      flow.nodes[2] = {
        id: "c",
        label: "C",
        evidence: { source: "svc-b", match: { event: ["b.ok"], correlate: "attributes.order_id" }, outcome: { success: "b.ok" } },
      };
      const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done"), ev("2026-10-31T09:01:00Z", "svc-b", "b.ok")], flow);
      expect(result.nodes.b?.evidence).toHaveLength(1);
      expect(result.nodes.c?.evidence).toHaveLength(1);
      expect(result.edges.map((e) => e.to)).toEqual(["b", "c"]);
    });
  });

  describe("unexpected transitions", () => {
    it("flags a node reached with no declared predecessor, from the latest event before it", () => {
      const skipped = ev("2026-10-31T09:05:00Z", "svc-c", "c.done");
      const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done"), skipped]);
      expect(result.unexpected).toEqual([{ from: "a", to: "c", ts: skipped.ts, ref: skipped.ref }]);
    });

    it("does not flag a transition whose pair the flow declares, even if its condition was not met", () => {
      const result = run([
        ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
        ev("2026-10-31T09:01:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:02:00Z", "svc-c", "c.done"),
      ]);
      expect(result.unexpected).toEqual([]);
      expect(result.nodes.c?.status).toBe("success");
    });

    it("says nothing when the log starts mid-flow and nothing precedes the first event", () => {
      expect(run([ev("2026-10-31T09:01:00Z", "svc-b", "b.ok")]).unexpected).toEqual([]);
    });

    it("never flags the start node", () => {
      expect(run([ev("2026-10-31T09:00:00Z", "svc-b", "b.ok"), ev("2026-10-31T09:01:00Z", "svc-a", "a.done")]).unexpected).toEqual([]);
    });
  });

  describe("node status", () => {
    it("takes the last outcome event: failure then success is success, success then failure is failure", () => {
      const base = ev("2026-10-31T09:00:00Z", "svc-a", "a.done");
      expect(run([base, ev("2026-10-31T09:01:00Z", "svc-b", "b.fail"), ev("2026-10-31T09:02:00Z", "svc-b", "b.ok")]).nodes.b?.status).toBe("success");
      expect(run([base, ev("2026-10-31T09:01:00Z", "svc-b", "b.ok"), ev("2026-10-31T09:02:00Z", "svc-b", "b.fail")]).nodes.b?.status).toBe("failure");
    });

    it("is pending when the node has events but no outcome event yet", () => {
      const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done"), ev("2026-10-31T09:01:00Z", "svc-b", "b.try")]);
      expect(result.nodes.b?.status).toBe("pending");
    });

    it("is pending when a node was enabled but has no events, not_reached when nothing enables it", () => {
      const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done"), ev("2026-10-31T09:01:00Z", "svc-b", "b.ok")]);
      expect(result.nodes.c?.status).toBe("pending");
      const early = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done")]);
      expect(early.nodes.b?.status).toBe("pending");
      expect(early.nodes.c?.status).toBe("not_reached");
    });

    it("is success for a node with evidence but no outcome rules, and not_reached for a node without evidence", () => {
      const flow = flowOf();
      flow.nodes[0] = { id: "a", label: "A", evidence: { source: "svc-a", match: { event: ["a.done"], correlate: "attributes.order_id" } } };
      flow.nodes[2] = { id: "c", label: "C" };
      const result = run([ev("2026-10-31T09:00:00Z", "svc-a", "a.done"), ev("2026-10-31T09:01:00Z", "svc-b", "b.ok")], flow);
      expect(result.nodes.a?.status).toBe("success");
      expect(result.nodes.c).toEqual({ status: "not_reached" });
    });
  });

  describe("display fields", () => {
    it("extracts last, first and count, and shows null for a field no event has", () => {
      const result = run([
        ev("2026-10-31T09:00:00Z", "svc-a", "a.done"),
        ev("2026-10-31T09:01:00Z", "svc-b", "b.try", { amount: 10 }),
        ev("2026-10-31T09:02:00Z", "svc-b", "b.fail"),
        ev("2026-10-31T09:03:00Z", "svc-b", "b.try", { amount: 12 }),
        ev("2026-10-31T09:04:00Z", "svc-b", "b.ok"),
      ]);
      expect(result.nodes.b?.fields).toEqual({ Status: "b.ok", Amount: 12, First: 10, Tries: 2 });
      expect(result.nodes.a?.fields).toBeUndefined();
      const none = run([ev("2026-10-31T09:01:00Z", "svc-b", "b.ok")]);
      expect(none.nodes.b?.fields).toEqual({ Status: "b.ok", Amount: null, First: null, Tries: 0 });
    });
  });

  describe("expressions", () => {
    const events = [
      ev("2026-10-31T09:00:00Z", "s", "x", { n: 1, deep: { k: "v" }, list: [1, 2], flag: false }),
      ev("2026-10-31T09:01:00Z", "s", "y", { n: 2 }),
    ];
    it("reads ts, event and nested attribute paths, and nothing else", () => {
      expect(readPath(events[0]!, "ts")).toBe("2026-10-31T09:00:00Z");
      expect(readPath(events[0]!, "event")).toBe("x");
      expect(readPath(events[0]!, "attributes.deep.k")).toBe("v");
      expect(readPath(events[0]!, "attributes.n.k")).toBeUndefined();
      expect(readPath(events[0]!, "attributes.list.0")).toBeUndefined();
      expect(readPath(events[0]!, "constructor")).toBeUndefined();
      expect(readPath(events[0]!, "attributes.constructor")).toBeUndefined();
    });
    it("evaluates bare paths as last(), booleans as booleans, structures as JSON text", () => {
      expect(evaluateExpression("attributes.n", events)).toBe(2);
      expect(evaluateExpression("first(attributes.n)", events)).toBe(1);
      expect(evaluateExpression("attributes.flag", events)).toBe(false);
      expect(evaluateExpression("attributes.deep", events)).toBe('{"k":"v"}');
      expect(evaluateExpression("count(x)", events)).toBe(1);
      expect(evaluateExpression("count(nope)", events)).toBe(0);
      expect(evaluateExpression("first(ts)", events)).toBe("2026-10-31T09:00:00Z");
    });
  });
});
