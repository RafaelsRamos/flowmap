import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateFlowSource, type Flow } from "@flowmap/core";
import { describe, expect, it } from "vitest";
import { searchNodes } from "../src/lib/search.js";

const text = readFileSync(join(import.meta.dirname, "../../../examples/order-fulfilment/flows/order-fulfilment.yml"), "utf8");
const flow = validateFlowSource(text, "order-fulfilment.yml").flow as Flow;
const ids = (query: string): string[] => searchNodes(flow, query).map((hit) => hit.id);

describe("searchNodes", () => {
  it("matches labels case-insensitively", () => {
    expect(ids("PAYMENT")).toEqual(["payment"]);
  });

  it("matches services, and says what matched", () => {
    expect(ids("delivery")).toEqual(["out-for-delivery", "delivered"]);
    expect(searchNodes(flow, "warehouse").find((hit) => hit.id === "pick-pack")).toEqual({ id: "pick-pack", reason: "service" });
  });

  it("matches log event names", () => {
    expect(ids("payment.declined")).toEqual(["payment"]);
    expect(searchNodes(flow, "payment.declined")[0]?.reason).toBe("event payment.declined");
    expect(ids("delivery.not_home")).toEqual(["out-for-delivery"]);
  });

  it("matches code anchors and descriptions", () => {
    expect(ids("ChargeHandler")).toEqual(["payment"]);
    expect(ids("courier")).toEqual(["out-for-delivery"]);
  });

  it("needs every word to match, in any field", () => {
    expect(ids("payment api")).toEqual(["payment"]);
    expect(ids("payment warehouse")).toEqual([]);
  });

  it("finds words in descriptions", () => {
    expect(ids("customer")).toEqual(["order-placed", "payment", "out-for-delivery", "delivered"]);
  });

  it("puts label matches before other matches", () => {
    const node = (id: string, label: string, service?: string) => ({ id, label, service });
    const small: Flow = {
      ...flow,
      nodes: [node("a", "Warehouse dispatch", "shipping"), node("b", "Pick", "warehouse")],
    };
    // `b` comes second in the file but matches by service only; `a` matches by label.
    expect(searchNodes(small, "warehouse").map((hit) => hit.id)).toEqual(["a", "b"]);
    const reversed: Flow = { ...flow, nodes: [...small.nodes].reverse() };
    expect(searchNodes(reversed, "warehouse").map((hit) => hit.id)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty query", () => {
    expect(ids("   ")).toEqual([]);
  });
});
