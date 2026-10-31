import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRun, validateFlowSource, validateRunSource } from "@flowmap/core";
import { buildQuery, ndjsonAdapter } from "../src/index.js";

const example = join(import.meta.dirname, "../../../examples/order-fulfilment");
const flow = validateFlowSource(readFileSync(join(example, "flows/order-fulfilment.yml"), "utf8"), "flow").flow;

/**
 * Golden tests: the sample logs must produce exactly the expected run files.
 * When a rule in docs/matching.md changes on purpose, regenerate the expected
 * files with `flowmap trace` and review the diff.
 */
async function trace(order: string) {
  const adapter = ndjsonAdapter([join(example, `logs/order-${order}.ndjson`)]);
  const { events, warnings } = await adapter.fetch(buildQuery(flow!, order));
  expect(warnings).toEqual([]);
  return matchRun({ flow: flow!, events, correlationValue: order, generatedAt: "2026-10-31T16:30:00Z", flowRevision: "git:3f2a9c1" });
}

const expected = (order: string): unknown => JSON.parse(readFileSync(join(example, `logs/order-${order}.run.json`), "utf8"));

describe("golden runs for examples/order-fulfilment/logs", () => {
  it("order 4821: payment declined then approved, one not-home, delivered (retry loop)", async () => {
    const run = await trace("4821");
    expect(run).toEqual(expected("4821"));
    expect(run.edges.find((e) => e.label === "retry")?.observed).toBe(1);
    expect(run.nodes.payment?.fields).toEqual({ Status: "payment.approved", Amount: "€84.90", Attempts: 2 });
    expect(run.unexpected).toEqual([]);
  });

  it("order 4830: paid but never packed, so pick-pack is pending (stuck order)", async () => {
    const run = await trace("4830");
    expect(run).toEqual(expected("4830"));
    expect(run.nodes["pick-pack"]?.status).toBe("pending");
    expect(run.nodes.delivered?.status).toBe("not_reached");
  });

  it("order 4831: dispatched without being packed (unexpected transition)", async () => {
    const run = await trace("4831");
    expect(run).toEqual(expected("4831"));
    expect(run.unexpected).toEqual([
      { from: "payment", to: "out-for-delivery", ts: "2026-10-31T08:05:00Z", ref: "file://order-4831.ndjson#L5" },
    ]);
  });

  it("every expected file passes validateRunSource against the flow", () => {
    for (const order of ["4821", "4830", "4831"]) {
      const result = validateRunSource(readFileSync(join(example, `logs/order-${order}.run.json`), "utf8"), `order-${order}.run.json`, { flow: flow! });
      expect(result.issues).toEqual([]);
    }
  });

  it("an id that is not in the logs matches nothing", async () => {
    const adapter = ndjsonAdapter([join(example, "logs/order-4821.ndjson")]);
    const { events } = await adapter.fetch(buildQuery(flow!, "0"));
    const run = matchRun({ flow: flow!, events, correlationValue: "0", generatedAt: "2026-10-31T16:30:00Z" });
    expect(Object.values(run.nodes).every((n) => n.status === "not_reached" && n.evidence === undefined)).toBe(true);
  });
});
