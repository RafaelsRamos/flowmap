import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { validateFlowSource } from "../src/index.js";

const example = join(import.meta.dirname, "../../../examples/order-fulfilment");
const read = (path: string): string => readFileSync(join(example, path), "utf8");

describe("order-fulfilment example", () => {
  it("passes with no issues", () => {
    const result = validateFlowSource(read("flows/order-fulfilment.yml"), "order-fulfilment.yml");
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.flow?.nodes).toHaveLength(6);
  });

  it("parses YAML and JSON to the same model", () => {
    const yamlText = read("flows/order-fulfilment.yml");
    const asJson = JSON.stringify(parse(yamlText), null, 2);
    const fromYaml = validateFlowSource(yamlText, "flow.yml");
    const fromJson = validateFlowSource(asJson, "flow.json");
    expect(fromJson.issues).toEqual([]);
    expect(fromJson.flow).toEqual(fromYaml.flow);
  });

  it("reports JSON positions too", () => {
    const broken = JSON.stringify({ ...parse(read("flows/order-fulfilment.yml")), end: "delivered" }, null, 2);
    const [issue] = validateFlowSource(broken, "flow.json").issues;
    expect(issue?.code).toBe("wrong-type");
    expect(broken.split("\n")[(issue?.line ?? 0) - 1]).toContain('"end"');
  });
});

/**
 * Every broken fixture fails with exactly one finding. `at` is a snippet of the
 * line the finding must point to (the last line containing it), so the table
 * stays readable and survives edits to the fixtures' headers.
 */
const broken: Array<{
  file: string;
  code: string;
  severity?: "error" | "warning";
  at: string;
  message: string;
}> = [
  { file: "syntax-error", code: "syntax", at: "nodes:", message: "Flow sequence" },
  { file: "empty-file", code: "empty-file", at: "BROKEN", message: "file is empty" },
  { file: "missing-required", code: "missing-property", at: "schemaVersion", message: 'missing required property "correlationKey"' },
  { file: "unknown-property", code: "unknown-property", at: "servce:", message: 'unknown property "servce" in nodes[1] (did you mean "service"?)' },
  { file: "reserved-property", code: "reserved-property", at: "subflow:", message: '"subflow" is reserved for a future version' },
  { file: "wrong-type", code: "wrong-type", at: "end: delivered", message: "end must be an array" },
  { file: "bad-id", code: "invalid-value", at: "Payment_Step", message: "nodes[1].id must be lowercase kebab-case" },
  { file: "unsupported-version", code: "invalid-value", at: "schemaVersion: 2", message: "schemaVersion must be 1" },
  { file: "bad-code-anchor", code: "invalid-value", at: "Charge Handler", message: "nodes[1].code must be a code anchor" },
  { file: "bad-display-expression", code: "invalid-value", at: "eval(", message: "nodes[1].evidence.display.Amount must be a path" },
  { file: "duplicate-node-id", code: "duplicate-node-id", at: "id: payment", message: 'node id "payment" is already used by nodes[1]' },
  { file: "unknown-start", code: "unknown-node", at: "start: order-created", message: 'start refers to unknown node "order-created"' },
  { file: "unknown-edge-target", code: "unknown-node", at: "to: shipped", message: 'edges[3].to refers to unknown node "shipped"' },
  { file: "unreachable-node", code: "unreachable-node", at: "id: refunded", message: 'node "refunded" is not reachable from start "order-placed"' },
  { file: "undeclared-terminal", code: "undeclared-terminal", at: "id: refunded", message: 'node "refunded" has no outgoing edge' },
  { file: "outcome-not-matched", code: "outcome-event-not-matched", at: "success: payment.captured", message: 'outcome.success is "payment.captured"' },
  { file: "display-count-not-matched", code: "display-event-not-matched", at: "count(payment.retried)", message: 'counts "payment.retried"' },
];

describe("broken fixtures", () => {
  it.each(broken)("$file fails with $code", ({ file, code, at, message }) => {
    const text = read(`flows-broken/${file}.yml`);
    const result = validateFlowSource(text, `${file}.yml`);

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue?.severity).toBe("error");
    expect(issue?.code).toBe(code);
    expect(issue?.message).toContain(message);

    const lines = text.split("\n");
    const expectedLine = lines.findLastIndex((line) => line.includes(at)) + 1;
    expect(expectedLine).toBeGreaterThan(0);
    expect(issue?.line).toBe(expectedLine);
  });

  it("warnings do not fail validation", () => {
    const result = validateFlowSource(read("flows-broken/warnings.yml"), "warnings.yml");
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => [i.severity, i.code])).toEqual([
      ["warning", "duplicate-edge"],
      ["warning", "edge-event-not-matched"],
    ]);
  });

  it("lists issues in file order", () => {
    const text = stringify({ ...parse(read("flows/order-fulfilment.yml")), start: "nope", end: ["gone"] });
    const result = validateFlowSource(text, "x.yml");
    const lines = result.issues.map((i) => i.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(result.issues.map((i) => i.code)).toContain("unknown-node");
  });

  it("reports duplicate keys as syntax errors", () => {
    const result = validateFlowSource("flow: a\nflow: b\n", "dup.yml");
    expect(result.issues[0]?.code).toBe("syntax");
    expect(result.issues[0]?.line).toBe(2);
  });

  it("does not run graph rules on a structurally invalid file", () => {
    const text = read("flows-broken/wrong-type.yml");
    expect(validateFlowSource(text, "x.yml").issues.every((i) => i.code === "wrong-type")).toBe(true);
  });
});
