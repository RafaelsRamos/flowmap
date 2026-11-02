import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateFlowSource } from "@flowmap/core";
import { traceFromLogs, type LogInput } from "../src/lib/trace.js";

const fixture = join(import.meta.dirname, "../../../examples/order-fulfilment");
const read = (path: string): string => readFileSync(join(fixture, path), "utf8");
const flow = validateFlowSource(read("flows/order-fulfilment.yml"), "flow").flow!;
const now = new Date("2026-10-31T16:30:00Z");
const log = (path: string): LogInput => ({ name: path.split("/").pop()!, text: read(path) });

describe("traceFromLogs", () => {
  it("gives the same run as the golden file for an NDJSON export (apart from generatedAt)", () => {
    const outcome = traceFromLogs({ flow, correlationValue: "4821", logs: [log("logs/order-4821.ndjson")], now });
    if (!outcome.ok) throw new Error(outcome.error);
    const golden = JSON.parse(read("flows/examples/order-4821.run.json")) as object;
    expect({ ...outcome.run, flowRevision: "git:3f2a9c1" }).toEqual(golden);
    expect(outcome.summary).toEqual({ eventsRead: 12, eventsMatched: 10, unexpected: 0 });
  });

  it("reads a free-text .log with a custom format, keeping the raw lines", () => {
    const outcome = traceFromLogs({
      flow,
      correlationValue: "4827",
      logs: [log("logs/text/order-4827.log")],
      format: read("logs/text/order-4827.format.yml"),
      now,
    });
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.run.nodes.payment?.evidence?.[1]?.raw).toContain("Card declined for order 4827");
    expect(outcome.run.nodes.payment?.fields?.Attempts).toBe(2);
    expect(outcome.warnings.join("\n")).toContain("3 lines carried no usable event");
  });

  it("takes the source from the file name, but pasted text must name its own", () => {
    const line = "2026-10-31T09:00:00Z event=order.placed order_id=7";
    const named = traceFromLogs({ flow, correlationValue: "7", logs: [{ name: "orders-api.log", text: line }], now });
    expect(named.ok).toBe(true);
    const pasted = traceFromLogs({ flow, correlationValue: "7", logs: [{ name: "pasted.log", text: line, pasted: true }], now });
    expect(pasted.ok).toBe(false);
    const withSource = traceFromLogs({ flow, correlationValue: "7", logs: [{ name: "pasted.log", text: `${line} source=orders-api`, pasted: true }], now });
    expect(withSource.ok).toBe(true);
  });

  it("explains what is missing instead of producing an empty run", () => {
    expect(traceFromLogs({ flow, correlationValue: " ", logs: [log("logs/order-4821.ndjson")], now })).toMatchObject({ ok: false, error: "Enter the orderId to trace." });
    expect(traceFromLogs({ flow, correlationValue: "1", logs: [], now })).toMatchObject({ ok: false, error: expect.stringContaining("Add a log file") });
    expect(traceFromLogs({ flow, correlationValue: "9999", logs: [log("logs/order-4821.ndjson")], now })).toMatchObject({ ok: false, error: expect.stringContaining("No events matched orderId 9999") });
    expect(traceFromLogs({ flow, correlationValue: "1", logs: [log("logs/order-4821.ndjson")], format: "pattern: '('", now })).toMatchObject({ ok: false, error: expect.stringContaining("pattern is not a valid regular expression") });
  });
});
