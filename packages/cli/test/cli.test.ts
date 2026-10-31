import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

const repo = join(import.meta.dirname, "../../..");

function cli(args: string[], cwd = repo) {
  let stdout = "";
  let stderr = "";
  const code = run(args, { cwd, stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  return { code, stdout, stderr };
}

describe("flowmap validate", () => {
  it("passes the order example directory with exit 0", () => {
    const { code, stdout } = cli(["validate", "examples/order-fulfilment/flows"]);
    expect(code).toBe(0);
    expect(stdout).toContain("✔ no problems in 1 file");
  });

  it("prints file:line:col, severity, message and code for errors", () => {
    const { code, stdout } = cli(["validate", "examples/order-fulfilment/flows-broken/unknown-property.yml"]);
    expect(code).toBe(1);
    expect(stdout).toMatch(
      /examples\/order-fulfilment\/flows-broken\/unknown-property\.yml:21:5  error  unknown property "servce" in nodes\[1\] \(did you mean "service"\?\)  \[unknown-property\]/,
    );
    expect(stdout).toContain("✖ 1 error, 0 warnings in 1 file");
  });

  it("exits 0 for warnings only", () => {
    const { code, stdout } = cli(["validate", "examples/order-fulfilment/flows-broken/warnings.yml"]);
    expect(code).toBe(0);
    expect(stdout).toContain("warning");
  });

  it("--json emits structured results for agents", () => {
    const { code, stdout } = cli(["validate", "--json", "examples/order-fulfilment/flows-broken/unknown-start.yml"]);
    const report = JSON.parse(stdout);
    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({ files: 1, errors: 1, warnings: 0 });
    expect(report.files[0].issues[0]).toMatchObject({
      severity: "error",
      code: "unknown-node",
      path: "start",
      line: 5,
      column: 8,
    });
    expect(report.files[0].flow).toBeUndefined();
  });

  it("walks directories, skipping examples/, run documents and non-flow dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "flowmap-cli-"));
    const flows = join(dir, "flows");
    mkdirSync(join(flows, "examples"), { recursive: true });
    const valid = JSON.stringify({
      schemaVersion: 1,
      flow: "tiny",
      correlationKey: "id",
      start: "a",
      end: ["b"],
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    writeFileSync(join(flows, "tiny.json"), valid);
    writeFileSync(join(flows, "order-4821.run.json"), "{ not a flow");
    writeFileSync(join(flows, "examples", "sample.yml"), "not: a flow");

    const { code, stdout } = cli(["validate", "flows"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain("no problems in 1 file");
  });

  it("validates a file named explicitly even if it would be skipped in a directory", () => {
    const { code } = cli(["validate", "examples/order-fulfilment/flows-broken/empty-file.yml"]);
    expect(code).toBe(1);
  });

  it("exits 2 on usage and I/O errors", () => {
    expect(cli([]).code).toBe(2);
    expect(cli(["validate"]).code).toBe(2);
    expect(cli(["nonsense"]).code).toBe(2);
    expect(cli(["validate", "does/not/exist.yml"]).code).toBe(2);
    expect(cli(["validate", "--bogus", "x"]).code).toBe(2);
  });

  it("prints help with exit 0", () => {
    const { code, stdout } = cli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: flowmap validate");
  });
});
