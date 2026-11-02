import { describe, expect, it } from "vitest";
import { parseLogText, readLogFormat } from "../src/index.js";

const parse = (text: string, options = {}) => parseLogText(text, "payments-api.log", { defaultSource: "payments-api", ...options });

describe("parseLogText: automatic readers", () => {
  it("reads a timestamp followed by key=value pairs, keeping the line as raw", () => {
    const line = '2026-10-31T09:03:00Z WARN event=payment.declined order_id=4821 amount="€84.90" msg="Card declined"';
    const { events, warnings } = parse(line);
    expect(warnings).toEqual([]);
    expect(events).toEqual([
      {
        ts: "2026-10-31T09:03:00Z",
        source: "payments-api",
        event: "payment.declined",
        msg: "Card declined",
        attributes: { order_id: "4821", amount: "€84.90" },
        ref: "file://payments-api.log#L1",
        raw: line,
      },
    ]);
  });

  it("takes the source from service= or source= over the file name, and the message from the text left over", () => {
    const { events } = parse("2026-10-31T09:03:00Z INFO service=inventory event=stock.reserved order_id=1 Stock reserved for the order");
    expect(events[0]).toMatchObject({ source: "inventory", msg: "Stock reserved for the order" });
  });

  it("reads JSON objects, alone or after a timestamp and level", () => {
    const { events } = parse(
      [
        '{"ts":"2026-10-31T09:00:00Z","event":"a","attributes":{"order_id":"1"}}',
        '2026-10-31T09:01:00Z INFO {"event":"b","attributes":{"order_id":"1"}}',
        '2026-10-31T09:02:00Z INFO took {"not":"an event line"}',
      ].join("\n"),
    );
    expect(events.map((e) => [e.ts, e.event, e.source])).toEqual([
      ["2026-10-31T09:00:00Z", "a", "payments-api"],
      ["2026-10-31T09:01:00Z", "b", "payments-api"],
    ]);
  });

  it("ignores lines with no usable event in one warning per file, and does not warn for the clean ones", () => {
    const { events, warnings } = parse(
      ["2026-10-31T09:00:00Z INFO event=a order_id=1", "2026-10-31T09:00:01Z INFO nothing structured here", "    at Some.stack(Frame.java:1)", ""].join("\n"),
    );
    expect(events).toHaveLength(1);
    expect(warnings).toEqual([
      "payments-api.log: 2 lines carried no usable event and were ignored (first: line 2, no event name (add event=<name> to the line, or an events rule in the log format))",
    ]);
  });

  it("converts naive timestamps using the zone given, and warns when it had to assume one", () => {
    const text = "2026-10-31 09:00:00,250 event=a order_id=1";
    const assumed = parse(text);
    expect(assumed.events[0]?.ts).toBe("2026-10-31T09:00:00.250Z");
    expect(assumed.warnings).toEqual(["payments-api.log: some timestamps have no time zone; assumed UTC (set \"timezone\" in the log format to change it)"]);
    const configured = parse(text, { format: { timezone: "+0200" } });
    expect(configured.events[0]?.ts).toBe("2026-10-31T09:00:00.250+02:00");
    expect(configured.warnings).toEqual([]);
  });

  it("numbers refs by physical line, tolerates CRLF and a byte order mark", () => {
    const { events } = parse("﻿\r\n2026-10-31T09:00:00Z event=a x=1\r\n\r\n2026-10-31T09:00:01Z event=b x=1\r\n");
    expect(events.map((e) => e.ref)).toEqual(["file://payments-api.log#L2", "file://payments-api.log#L4"]);
    expect(events[0]?.raw).toBe("2026-10-31T09:00:00Z event=a x=1");
  });

  it("cuts an absurdly long raw line", () => {
    const { events } = parse(`2026-10-31T09:00:00Z event=a pad=${"x".repeat(9000)}`);
    expect(events[0]?.raw?.length).toBe(4001);
    expect(events[0]?.raw?.endsWith("…")).toBe(true);
  });
});

describe("parseLogText: log format", () => {
  const format = readLogFormat({
    pattern: "^(?<ts>\\S+ \\S+) (?<level>\\w+) \\[(?<source>[\\w-]+)\\] (?<msg>.*)$",
    timezone: "UTC",
    events: [{ match: "Card declined for order (?<order_id>\\d+)", event: "payment.declined" }],
  });

  it("splits the line with the pattern and names the event from the message, taking attributes from the groups", () => {
    const line = "2026-10-31 09:03:00,000 WARN [payments-api] Card declined for order 4821: insufficient funds";
    const { events } = parseLogText(line, "x.log", { format });
    expect(events[0]).toMatchObject({
      ts: "2026-10-31T09:03:00.000Z",
      source: "payments-api",
      event: "payment.declined",
      msg: "Card declined for order 4821: insufficient funds",
      attributes: { level: "WARN", order_id: "4821" },
      raw: line,
    });
  });

  it("ignores lines that do not match the pattern or any rule", () => {
    const { events, warnings } = parseLogText(
      ["java.lang.Exception: boom", "2026-10-31 09:03:00,000 INFO [payments-api] heartbeat"].join("\n"),
      "x.log",
      { format },
    );
    expect(events).toEqual([]);
    expect(warnings[0]).toContain("2 lines carried no usable event");
    expect(warnings[0]).toContain("does not match the log format pattern");
  });
});

describe("readLogFormat", () => {
  it("accepts an empty format and rejects mistakes with a message", () => {
    expect(readLogFormat({})).toEqual({});
    expect(() => readLogFormat([])).toThrow("must be an object");
    expect(() => readLogFormat({ paterrn: "x" })).toThrow('unknown property "paterrn"');
    expect(() => readLogFormat({ pattern: "(" })).toThrow("pattern is not a valid regular expression");
    expect(() => readLogFormat({ events: [{ match: "x" }] })).toThrow("events[0] needs");
    expect(() => readLogFormat({ events: [{ match: "[", event: "e" }] })).toThrow("events[0].match");
    expect(() => readLogFormat({ timezone: "Europe/Lisbon" })).toThrow("timezone must be");
  });
});
