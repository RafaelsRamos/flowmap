import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRun, parseSource, validateFlowSource, validateRunSource } from "@flowmap/core";
import { buildQuery, readLogFormat } from "../src/index.js";
import { fileAdapter } from "../src/node.js";

const example = join(import.meta.dirname, "../../../examples/order-fulfilment");
const flow = validateFlowSource(readFileSync(join(example, "flows/order-fulfilment.yml"), "utf8"), "flow").flow;

/**
 * Golden tests: the sample logs must produce exactly the expected run files.
 * When a rule in docs/matching.md changes on purpose, regenerate the expected
 * files with `npm run examples:generate` and review the diff.
 */
async function trace(order: string, file = `logs/order-${order}.ndjson`, formatFile?: string) {
  const format = formatFile === undefined ? undefined : readLogFormat(parseSource(readFileSync(join(example, formatFile), "utf8")).data);
  const adapter = fileAdapter([join(example, file)], format === undefined ? {} : { format });
  const { events, warnings } = await adapter.fetch(buildQuery(flow!, order));
  expect(warnings.filter((w) => !w.includes("carried no usable event"))).toEqual([]);
  return matchRun({ flow: flow!, events, correlationValue: order, generatedAt: "2026-10-31T16:30:00.000Z", flowRevision: "git:3f2a9c1" });
}

const expected = (order: string): unknown => JSON.parse(readFileSync(join(example, `flows/examples/order-${order}.run.json`), "utf8"));

describe("golden runs for examples/order-fulfilment/logs", () => {
  it("order 4822: out of stock, but paid", async () => {
    const run = await trace("4822");
    expect(run).toEqual(expected("4822"));
    expect(run.nodes["stock-check"]?.status).toBe("failure");
  });

  it("order 4825: nobody home three times, still out for delivery", async () => {
    const run = await trace("4825");
    expect(run).toEqual(expected("4825"));
    expect(run.nodes["out-for-delivery"]?.fields).toEqual({ "Not home": 3 });
    expect(run.edges.find((e) => e.label === "not home")?.observed).toBe(2);
  });

  it("order 4821: payment declined then approved, one not-home, delivered (retry loop)", async () => {
    const run = await trace("4821");
    expect(run).toEqual(expected("4821"));
    expect(run.edges.find((e) => e.label === "retry")?.observed).toBe(1);
    expect(run.nodes.payment?.fields).toEqual({ Status: "payment.approved", Amount: "€84.90", Attempts: 2 });
    expect(run.unexpected).toEqual([]);
  });

  it("order 4826: paid but never packed, so pick-pack is pending (stuck order)", async () => {
    const run = await trace("4826");
    expect(run).toEqual(expected("4826"));
    expect(run.nodes["pick-pack"]?.status).toBe("pending");
    expect(run.nodes.delivered?.status).toBe("not_reached");
  });

  it("order 4823: dispatched without being packed (unexpected transition)", async () => {
    const run = await trace("4823");
    expect(run).toEqual(expected("4823"));
    expect(run.unexpected).toEqual([
      expect.objectContaining({ from: "payment", to: "out-for-delivery", ts: "2026-10-31T08:05:00Z", ref: "file://order-4823.ndjson#L5" }),
    ]);
    expect(run.unexpected[0]?.raw).toContain('"event":"delivery.dispatched"');
  });

  it("order 4827: the same story as 4821 from a free-text .log, read with a log format file", async () => {
    const run = await trace("4827", "logs/text/order-4827.log", "logs/text/order-4827.format.yml");
    expect(run).toEqual(expected("4827"));
    expect(run.nodes.payment?.fields).toEqual({ Status: "payment.approved", Amount: "€63.20", Attempts: 2 });
    expect(run.nodes.payment?.evidence?.[1]).toMatchObject({
      event: "payment.declined",
      raw: "2026-10-31 10:00:06,330 WARN  [payments-api] Card declined for order 4827: insufficient funds",
    });
    expect(run.edges.find((e) => e.label === "retry")?.observed).toBe(1);
  });

  it("order 4824: a .log mixing key=value and JSON lines needs no format file; payment gives up", async () => {
    const run = await trace("4824", "logs/text/order-4824.log");
    expect(run).toEqual(expected("4824"));
    expect(run.nodes.payment?.status).toBe("failure");
    expect(run.edges.find((e) => e.label === "retry")?.observed).toBe(2);
  });

  it("every evidence entry carries the raw log line it came from", () => {
    for (const order of ["4821", "4822", "4823", "4824", "4825", "4826", "4827"]) {
      const run = expected(order) as { nodes: Record<string, { evidence?: { raw?: string }[] }> };
      for (const node of Object.values(run.nodes)) for (const entry of node.evidence ?? []) expect(entry.raw).toEqual(expect.any(String));
    }
  });

  it("every expected file passes validateRunSource against the flow", () => {
    for (const order of ["4821", "4822", "4823", "4824", "4825", "4826", "4827"]) {
      const result = validateRunSource(readFileSync(join(example, `flows/examples/order-${order}.run.json`), "utf8"), `order-${order}.run.json`, { flow: flow! });
      expect(result.issues).toEqual([]);
    }
  });

  it("an id that is not in the logs matches nothing", async () => {
    const adapter = fileAdapter([join(example, "logs/order-4821.ndjson")]);
    const { events } = await adapter.fetch(buildQuery(flow!, "0"));
    const run = matchRun({ flow: flow!, events, correlationValue: "0", generatedAt: "2026-10-31T16:30:00Z" });
    expect(Object.values(run.nodes).every((n) => n.status === "not_reached" && n.evidence === undefined)).toBe(true);
  });
});
