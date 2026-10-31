import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { validateFlowSource, validateRunSource, type Flow } from "../src/index.js";

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

const flow = validateFlowSource(read("flows/order-fulfilment.yml"), "order-fulfilment.yml").flow as Flow;

describe("sample runs", () => {
  it.each(["order-4821", "order-4822", "order-4823"])("%s passes against the flow", (name) => {
    const result = validateRunSource(read(`flows/examples/${name}.run.json`), `${name}.run.json`, { flow });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.run?.flow).toBe("order-fulfilment");
  });

  it("covers the retry and not-home loops, a stuck order and an unexpected transition", () => {
    const run = (name: string) => validateRunSource(read(`flows/examples/${name}.run.json`), name, { flow }).run;
    const loops = run("order-4821")?.edges.filter((edge) => edge.from === edge.to).map((edge) => edge.label);
    expect(loops).toEqual(["retry", "not home"]);
    expect(run("order-4822")?.nodes["stock-check"]?.status).toBe("failure");
    expect(run("order-4823")?.unexpected).toHaveLength(1);
  });

  it("validates without a flow too, skipping the checks that need one", () => {
    const text = read("flows-broken/run-unknown-node.run.json");
    expect(validateRunSource(text, "x").issues).toEqual([]);
  });

  it("accepts YAML as well as JSON", () => {
    const yamlText = stringify(JSON.parse(read("flows/examples/order-4822.run.json")));
    expect(validateRunSource(yamlText, "x.run.yml", { flow }).issues).toEqual([]);
  });
});

const brokenRuns: Array<{
  file: string;
  code: string;
  severity?: "error" | "warning";
  at: string;
  message: string;
  /** The finding points at the `{` this many lines above the matched line. */
  above?: number;
  /** Fixed line, for findings that point at the document root. */
  line?: number;
}> = [
  { file: "run-syntax-error", code: "syntax", at: '"nodes"', message: "Missing , between flow map items" },
  { file: "run-empty-file", code: "empty-file", at: "BROKEN", message: "file is empty; expected a run document" },
  { file: "run-missing-required", code: "missing-property", at: "{", line: 1, message: 'missing required property "generatedAt"' },
  { file: "run-unknown-property", code: "unknown-property", at: "flowRevison", message: 'unknown property "flowRevison" in the document (did you mean "flowRevision"?)' },
  { file: "run-wrong-type", code: "wrong-type", at: '"observed": "1"', message: "edges[0].observed must be an integer" },
  { file: "run-bad-status", code: "invalid-value", at: '"status": "done"', message: "nodes.payment.status must be one of success, failure, pending, not_reached" },
  { file: "run-bad-timestamp", code: "invalid-value", at: '"09:03"', message: "nodes.payment.evidence[0].ts must be an ISO 8601 timestamp" },
  { file: "run-bad-ref", code: "invalid-value", at: "payments-api line 31", message: "nodes.payment.evidence[0].ref must be a reference URI" },
  { file: "run-bad-node-key", code: "invalid-value", at: '"Payment_Step"', message: 'key "Payment_Step" in nodes must be lowercase kebab-case' },
  { file: "run-status-evidence-mismatch", code: "status-evidence-mismatch", at: '"status": "not_reached"', message: 'node "delivered" is not_reached but has 1 evidence entry' },
  { file: "run-evidence-out-of-order", code: "evidence-out-of-order", severity: "warning", at: '"ts": "2026-10-31T09:03:00Z"', message: "nodes.payment.evidence[1] is earlier than the entry before it" },
  { file: "run-flow-mismatch", code: "flow-mismatch", at: '"flow": "returns"', message: 'run is for flow "returns" but was checked against flow "order-fulfilment"' },
  { file: "run-unknown-node", code: "unknown-node", at: '"refunded"', message: 'nodes."refunded" is not a node of flow "order-fulfilment"' },
  { file: "run-unknown-edge-target", code: "unknown-node", at: '"to": "shipped"', message: 'edges[0].to refers to unknown node "shipped"' },
  { file: "run-undeclared-edge", code: "undeclared-edge", at: '"from": "payment"', above: 1, message: "edges[8] payment -> delivered is not declared by the flow" },
  { file: "run-declared-edge-unexpected", code: "declared-edge-unexpected", at: '"from": "payment"', above: 1, message: "unexpected[0] payment -> pick-pack is declared by the flow" },
  { file: "run-missing-node", code: "missing-node", severity: "warning", at: '"nodes": {', message: 'flow node "pick-pack" has no entry in nodes' },
  { file: "run-evidence-event-not-matched", code: "evidence-event-not-matched", severity: "warning", at: '"event": "payment.captured"', message: 'nodes.payment.evidence[1] has event "payment.captured"' },
];

describe("broken run fixtures", () => {
  it.each(brokenRuns)("$file reports $code", ({ file, code, severity = "error", at, above = 0, line, message }) => {
    const text = read(`flows-broken/${file}.run.json`);
    const result = validateRunSource(text, `${file}.run.json`, { flow });

    expect(result.ok).toBe(severity === "warning");
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue?.severity).toBe(severity);
    expect(issue?.code).toBe(code);
    expect(issue?.message).toContain(message);

    const lines = text.split("\n");
    const expectedLine = line ?? lines.findLastIndex((l) => l.includes(at)) + 1 - above;
    expect(expectedLine).toBeGreaterThan(0);
    expect(issue?.line).toBe(expectedLine);
  });

  it("does not run coherence rules on a structurally invalid run", () => {
    const text = read("flows-broken/run-wrong-type.run.json");
    expect(validateRunSource(text, "x", { flow }).issues.every((i) => i.code === "wrong-type")).toBe(true);
  });

  it("stops after a flow mismatch instead of listing every difference", () => {
    const run = JSON.parse(read("flows/examples/order-4821.run.json"));
    const other = { ...run, flow: "returns" };
    const issues = validateRunSource(JSON.stringify(other, null, 2), "x", { flow }).issues;
    expect(issues.map((i) => i.code)).toEqual(["flow-mismatch"]);
  });
});
