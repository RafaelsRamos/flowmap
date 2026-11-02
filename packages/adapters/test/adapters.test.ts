import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLogql, buildQuery, lokiAdapter, normaliseRecord, parseNdjson } from "../src/index.js";
import { fileAdapter } from "../src/node.js";
import type { Flow } from "@flowmap/core";

const query = {
  sources: ["orders-api", "payments.api"],
  correlationKey: "orderId",
  correlationValue: "4821",
  correlatePaths: ["attributes.order_id"],
};

describe("normaliseRecord", () => {
  it("reads the canonical shape", () => {
    expect(
      normaliseRecord({ ts: "2026-10-31T09:00:00Z", source: "s", event: "e", msg: "m", attributes: { a: 1 } }, "file://f#L1"),
    ).toEqual({ event: { ts: "2026-10-31T09:00:00Z", source: "s", event: "e", msg: "m", attributes: { a: 1 }, ref: "file://f#L1" } });
  });

  it("accepts aliases and turns the remaining fields into attributes", () => {
    expect(normaliseRecord({ timestamp: "2026-10-31T09:00:00+01:00", service: "s", event: "e", message: "m", order_id: "1" }, "file://f#L1")).toEqual({
      event: { ts: "2026-10-31T09:00:00+01:00", source: "s", event: "e", msg: "m", attributes: { order_id: "1" }, ref: "file://f#L1" },
    });
  });

  it("converts epoch seconds and milliseconds", () => {
    const seconds = normaliseRecord({ ts: 1793437200, source: "s", event: "e" }, "file://f#L1");
    const millis = normaliseRecord({ ts: 1793437200000, source: "s", event: "e" }, "file://f#L1");
    expect(seconds).toMatchObject({ event: { ts: "2026-10-31T09:00:00.000Z" } });
    expect(millis).toMatchObject({ event: { ts: "2026-10-31T09:00:00.000Z" } });
  });

  it("falls back to the defaults, and says why a record cannot be used", () => {
    expect(normaliseRecord({ event: "e" }, "r", { source: "s", ts: "2026-10-31T09:00:00Z" })).toMatchObject({ event: { source: "s", ts: "2026-10-31T09:00:00Z" } });
    expect(normaliseRecord([], "r")).toEqual({ reason: "not a JSON object" });
    expect(normaliseRecord({ source: "s", event: "e" }, "r")).toEqual({ reason: "no timestamp" });
    expect(normaliseRecord({ ts: "2026-10-31 09:00:00", source: "s", event: "e" }, "r")).toEqual({ reason: 'unrecognised timestamp "2026-10-31 09:00:00"' });
    expect(normaliseRecord({ ts: "2026-10-31T09:00:00Z", event: "e" }, "r")).toMatchObject({ reason: expect.stringContaining("no source") });
    expect(normaliseRecord({ ts: "2026-10-31T09:00:00Z", source: "s" }, "r")).toMatchObject({ reason: expect.stringContaining("no event name") });
  });
});

describe("parseNdjson", () => {
  it("numbers refs by physical line, skipping blank lines and reporting bad ones", () => {
    const text = [
      '{"ts":"2026-10-31T09:00:00Z","source":"s","event":"a"}',
      "",
      "not json",
      '{"ts":"2026-10-31T09:01:00Z","source":"s"}',
      '{"ts":"2026-10-31T09:02:00Z","source":"s","event":"b"}',
    ].join("\r\n");
    const { events, warnings } = parseNdjson(text, "my logs.ndjson");
    expect(events.map((e) => e.ref)).toEqual(["file://my%20logs.ndjson#L1", "file://my%20logs.ndjson#L5"]);
    expect(warnings).toEqual(["my logs.ndjson:3: skipped, not valid JSON", "my logs.ndjson:4: skipped, no event name (expected an event field)"]);
  });

  it("ignores a byte order mark", () => {
    expect(parseNdjson('﻿{"ts":"2026-10-31T09:00:00Z","source":"s","event":"a"}', "f").events).toHaveLength(1);
  });
});

describe("fileAdapter on NDJSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "flowmap-ndjson-"));
  const a = join(dir, "a.ndjson");
  const b = join(dir, "b.ndjson");
  writeFileSync(a, '{"ts":"2026-10-31T09:00:00Z","source":"orders-api","event":"x"}\n{"ts":"2026-10-31T09:00:00Z","source":"other","event":"x"}\n');
  writeFileSync(b, '{"ts":"2026-10-31T10:00:00Z","source":"orders-api","event":"y"}\n');

  it("reads several files, keeps only the query's sources and honours the window", async () => {
    const adapter = fileAdapter([a, b]);
    expect((await adapter.fetch(query)).events.map((e) => e.event)).toEqual(["x", "y"]);
    const windowed = await adapter.fetch({ ...query, from: new Date("2026-10-31T09:30:00Z") });
    expect(windowed.events.map((e) => e.event)).toEqual(["y"]);
  });

  it("names a missing file", async () => {
    await expect(fileAdapter([join(dir, "missing.ndjson")]).fetch(query)).rejects.toThrow(/cannot read ".*missing\.ndjson"/);
  });
});

describe("buildQuery", () => {
  it("derives sources and correlation paths from the flow", () => {
    const flow: Flow = {
      schemaVersion: 1,
      flow: "f",
      correlationKey: "orderId",
      start: "a",
      end: ["b"],
      nodes: [
        { id: "a", label: "A", evidence: { source: "s1", match: { event: ["e"], correlate: "attributes.order_id" } } },
        { id: "b", label: "B", evidence: { source: "s1", match: { event: ["f"], correlate: "attributes.order_id" } } },
        { id: "c", label: "C" },
      ],
      edges: [],
    };
    expect(buildQuery(flow, "7")).toEqual({ sources: ["s1"], correlationKey: "orderId", correlationValue: "7", correlatePaths: ["attributes.order_id"] });
  });
});

describe("lokiAdapter", () => {
  const ns = (iso: string, extra = 0) => (BigInt(Date.parse(iso)) * 1_000_000n + BigInt(extra)).toString();
  const window = { from: new Date("2026-10-31T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

  function mock(pages: unknown[]) {
    const calls: { url: URL; headers: Record<string, string> }[] = [];
    const fn = (async (input: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: new URL(input), headers: init?.headers ?? {} });
      const body = pages[calls.length - 1] ?? { data: { result: [] } };
      return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" };
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("builds a LogQL query from the flow's sources and the instance id", () => {
    expect(buildLogql("service", query)).toBe('{service=~"orders-api|payments\\\\.api"} |= "4821"');
  });

  it("normalises JSON lines, takes the source from the stream label and refs from the timestamp", async () => {
    const { fn, calls } = mock([
      {
        status: "success",
        data: {
          result: [
            {
              stream: { service: "payments-api" },
              values: [
                [ns("2026-10-31T09:03:00Z", 123456), JSON.stringify({ event: "payment.declined", msg: "Card declined", order_id: "4821" })],
                [ns("2026-10-31T09:04:00Z"), "plain text line"],
              ],
            },
          ],
        },
      },
    ]);
    const adapter = lokiAdapter({ url: "https://loki.example.com/", fetch: fn, tenant: "acme", bearerToken: "secret" });
    const { events, warnings } = await adapter.fetch({ ...query, ...window });
    expect(events).toEqual([
      {
        ts: "2026-10-31T09:03:00.000123456Z",
        source: "payments-api",
        event: "payment.declined",
        msg: "Card declined",
        attributes: { order_id: "4821" },
        ref: `loki://payments-api?ts=${ns("2026-10-31T09:03:00Z", 123456)}`,
        raw: JSON.stringify({ event: "payment.declined", msg: "Card declined", order_id: "4821" }),
      },
    ]);
    expect(Date.parse(events[0]!.ts)).toBe(Date.parse("2026-10-31T09:03:00Z"));
    expect(warnings).toEqual(["1 Loki line skipped: not JSON objects, so they carry no event name"]);
    expect(calls[0]?.url.pathname).toBe("/loki/api/v1/query_range");
    expect(calls[0]?.url.searchParams.get("direction")).toBe("forward");
    expect(calls[0]?.headers).toMatchObject({ "X-Scope-OrgID": "acme", Authorization: "Bearer secret" });
    expect(events[0]?.ref).not.toContain("secret");
  });

  it("pages forward when the result is full, and warns when it stops early", async () => {
    const line = (event: string) => JSON.stringify({ event });
    const page1 = { data: { result: [{ stream: { service: "s" }, values: [[ns("2026-10-31T09:00:00Z"), line("a")], [ns("2026-10-31T09:01:00Z"), line("b")]] }] } };
    const page2 = { data: { result: [{ stream: { service: "s" }, values: [[ns("2026-10-31T09:02:00Z"), line("c")]] }] } };
    const { fn, calls } = mock([page1, page2]);
    const result = await lokiAdapter({ url: "http://loki", fetch: fn, limit: 2 }).fetch({ ...query, ...window });
    expect(result.events.map((e) => e.event)).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
    expect(BigInt(calls[1]!.url.searchParams.get("start")!)).toBe(BigInt(ns("2026-10-31T09:01:00Z")) + 1n);

    const endless = mock([page1, page1, page1]);
    const capped = await lokiAdapter({ url: "http://loki", fetch: endless.fn, limit: 2, maxPages: 2 }).fetch({ ...query, ...window });
    expect(capped.warnings[0]).toMatch(/stopped after 2 pages/);
  });

  it("needs a time window, and reports HTTP errors without the credentials", async () => {
    await expect(lokiAdapter({ url: "http://loki", fetch: mock([]).fn }).fetch(query)).rejects.toThrow(/time window/);
    const failing = (async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "invalid token" })) as unknown as typeof fetch;
    await expect(lokiAdapter({ url: "http://loki", fetch: failing, bearerToken: "secret" }).fetch({ ...query, ...window })).rejects.toThrow("Loki answered 401 Unauthorized: invalid token");
  });
});
