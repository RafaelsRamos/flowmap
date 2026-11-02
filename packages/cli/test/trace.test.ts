import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateFlowSource, validateRunSource } from "@flowmap/core";
import { run, type Io } from "../src/run.js";

const repo = join(import.meta.dirname, "../../..");
const logs = "examples/order-fulfilment/logs";
const flows = "examples/order-fulfilment/flows";
const NOW = new Date("2026-10-31T16:30:00Z");

async function cli(args: string[], extra: Partial<Io> = {}) {
  let stdout = "";
  let stderr = "";
  const code = await run(args, { cwd: repo, now: () => NOW, env: {}, stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), ...extra });
  return { code, stdout, stderr };
}

const golden = (order: string) => JSON.parse(readFileSync(join(repo, flows, `examples/order-${order}.run.json`), "utf8"));
const trace = (extra: string[]) => ["trace", "order-fulfilment", "--flows", flows, "--flow-revision", "git:3f2a9c1", ...extra];

describe("flowmap trace", () => {
  it("prints exactly the expected run document for the sample logs", async () => {
    for (const order of ["4821", "4826", "4823"]) {
      const { code, stdout, stderr } = await cli(trace(["--orderId", order, "--logs", `${logs}/order-${order}.ndjson`]));
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual(golden(order));
      expect(stdout.endsWith("}\n")).toBe(true);
      expect(stderr).toContain(`✔ traced orderId ${order}`);
    }
  });

  it("reads a plain-text .log with a --log-format file, and keeps the raw lines", async () => {
    const text = `${logs}/text`;
    const { code, stdout, stderr } = await cli(trace(["--orderId", "4827", "--logs", `${text}/order-4827.log`, "--log-format", `${text}/order-4827.format.yml`]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(golden("4827"));
    expect(stderr).toContain("3 lines carried no usable event");
  });

  it("reads key=value and JSON-prefixed .log lines with no format file, naming the source from --source or the file", async () => {
    const { code, stdout } = await cli(trace(["--orderId", "4824", "--logs", `${logs}/text/order-4824.log`]));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(golden("4824"));
  });

  it("--no-raw leaves the raw lines out", async () => {
    const { stdout } = await cli(trace(["--orderId", "4821", "--logs", `${logs}/order-4821.ndjson`, "--no-raw"]));
    expect(stdout).not.toContain('"raw"');
    expect(JSON.parse(stdout).nodes.payment.evidence).toHaveLength(4);
  });

  it("reports a broken --log-format file as a usage error", async () => {
    const bad = await cli(trace(["--orderId", "1", "--logs", `${logs}/text/order-4827.log`, "--log-format", `${logs}/text/order-4827.log`]));
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("order-4827.log:");
    expect((await cli(trace(["--orderId", "1", "--logs", "x", "--log-format", "nope.yml"]))).stderr).toContain("cannot read the log format");
  });

  it("keeps stdout clean for redirection: the summary goes to stderr", async () => {
    const { stdout, stderr } = await cli(trace(["--orderId", "4823", "--logs", `${logs}/order-4823.ndjson`]));
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toBe("✔ traced orderId 4823: 5 of 5 events matched, 1 unexpected transition\n");
  });

  it("output passes validateRunSource against the flow", async () => {
    const flow = validateFlowSource(readFileSync(join(repo, flows, "order-fulfilment.yml"), "utf8"), "f").flow;
    const { stdout } = await cli(trace(["--orderId", "4821", "--logs", `${logs}/order-4821.ndjson`]));
    expect(validateRunSource(stdout, "run.json", { flow }).issues).toEqual([]);
  });

  it("accepts a flow file path and --id instead of the key flag, and several --logs files", async () => {
    const { code, stdout } = await cli([
      "trace", `${flows}/order-fulfilment.yml`, "--id", "4826", "--logs", `${logs}/order-4821.ndjson`, "--logs", `${logs}/order-4826.ndjson`,
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).correlation).toEqual({ orderId: "4826" });
  });

  it("--json wraps the run with a summary and warnings, like validate's structured output", async () => {
    const { code, stdout } = await cli(trace(["--orderId", "4821", "--logs", `${logs}/order-4821.ndjson`, "--json"]));
    const report = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ eventsRead: 12, eventsMatched: 10, unexpected: 0 });
    expect(report.warnings).toEqual([]);
    expect(report.run).toEqual(golden("4821"));
  });

  it("--json reports failures as {ok:false,error} on stdout", async () => {
    const { code, stdout, stderr } = await cli(trace(["--orderId", "9999", "--logs", `${logs}/order-4821.ndjson`, "--json"]));
    const report = JSON.parse(stdout);
    expect(code).toBe(1);
    expect(report).toMatchObject({ ok: false, error: { code: "no-events" } });
    expect(stderr).toBe("");
  });

  it("exits 1 with nothing on stdout when no event matches the id", async () => {
    const { code, stdout, stderr } = await cli(trace(["--orderId", "9999", "--logs", `${logs}/order-4821.ndjson`]));
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("no events matched flow \"order-fulfilment\" with orderId 9999 (12 events read from ndjson)");
  });

  it("reports skipped log lines as warnings without failing", async () => {
    const { code, stderr } = await cli(trace(["--orderId", "1", "--logs", "packages/cli/test/fixtures/bad-lines.ndjson"]));
    expect(code).toBe(0);
    expect(stderr).toContain("warning: bad-lines.ndjson:2: skipped, not valid JSON");
  });

  it("exits 2 on usage errors", async () => {
    const base = trace([]);
    expect((await cli(["trace"])).code).toBe(2);
    expect((await cli([...base, "--logs", `${logs}/order-4821.ndjson`])).stderr).toContain("pass --orderId <value>");
    expect((await cli([...base, "--orderId", "1"])).stderr).toContain("no log source");
    expect((await cli([...base, "--orderId", "1", "--logs", "x", "--loki-url", "http://l"])).stderr).toContain("not both");
    expect((await cli([...base, "--orderId", "1", "--id", "2", "--logs", "x"])).stderr).toContain("disagree");
    expect((await cli([...base, "--orderId", "1", "--logs", "x", "--from", "yesterday"])).stderr).toContain("--from");
    expect((await cli([...base, "--orderId", "1", "--logs", "x", "--bogus"])).code).toBe(2);
    expect((await cli(["trace", "no-such-flow", "--flows", flows, "--orderId", "1", "--logs", "x"])).stderr).toContain('no valid flow named "no-such-flow"');
    expect((await cli([...base, "--orderId", "1", "--logs", "missing.ndjson"])).stderr).toContain('cannot read "');
  });

  it("refuses to trace a flow that fails validation", async () => {
    const { code, stderr } = await cli(["trace", "examples/order-fulfilment/flows-broken/unknown-start.yml", "--id", "1", "--logs", "x"]);
    expect(code).toBe(1);
    expect(stderr).toContain("is not a valid flow");
  });

  it("reads from Loki with credentials taken from the environment", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: init?.headers ?? {} });
      const values = [[`${BigInt(Date.parse("2026-10-31T09:00:02Z")) * 1_000_000n}`, JSON.stringify({ event: "order.placed", order_id: "4821" })]];
      return { ok: true, status: 200, statusText: "OK", text: async () => "", json: async () => ({ data: { result: [{ stream: { app: "orders-api" }, values }] } }) };
    }) as unknown as typeof fetch;
    const { code, stdout } = await cli(
      trace(["--orderId", "4821", "--loki-url", "http://loki:3100", "--loki-label", "app", "--loki-tenant", "acme"]),
      { env: { FLOWMAP_LOKI_TOKEN: "secret" }, fetch: fetchFn },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout).nodes["order-placed"].evidence[0].ref).toMatch(/^loki:\/\/orders-api\?ts=\d+$/);
    expect(seen[0]?.headers).toMatchObject({ Authorization: "Bearer secret", "X-Scope-OrgID": "acme" });
    const url = new URL(seen[0]?.url ?? "");
    expect(url.searchParams.get("query")).toContain("{app=~");
    expect(Number(url.searchParams.get("end")) / 1e6).toBe(NOW.getTime());
    expect(Number(url.searchParams.get("start")) / 1e6).toBe(NOW.getTime() - 7 * 86400 * 1000);
  });

  it("exits 2 with the backend's message when Loki fails", async () => {
    const failing = (async () => ({ ok: false, status: 500, statusText: "Server Error", text: async () => "boom" })) as unknown as typeof fetch;
    const { code, stderr } = await cli(trace(["--orderId", "1", "--loki-url", "http://loki"]), { fetch: failing });
    expect(code).toBe(2);
    expect(stderr).toContain("Loki answered 500 Server Error: boom");
  });
});
