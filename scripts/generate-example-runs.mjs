// Regenerates examples/order-fulfilment/flows/examples/*.run.json from the sample logs in
// examples/order-fulfilment/logs, exactly as `flowmap trace` would (clock fixed, so the output is stable).
// Run `npm run examples:generate` after changing a matching rule or a sample log, then review the diff:
// the golden tests compare these files with the engine's output.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../packages/cli/dist/run.js";

const root = new URL("..", import.meta.url).pathname;
const logs = "examples/order-fulfilment/logs";
const out = "examples/order-fulfilment/flows/examples";
const NOW = new Date("2026-10-31T16:30:00Z");

const samples = [
  { id: "4821", logs: [`${logs}/order-4821.ndjson`] },
  { id: "4822", logs: [`${logs}/order-4822.ndjson`] },
  { id: "4823", logs: [`${logs}/order-4823.ndjson`] },
  { id: "4824", logs: [`${logs}/text/order-4824.log`] },
  { id: "4825", logs: [`${logs}/order-4825.ndjson`] },
  { id: "4826", logs: [`${logs}/order-4826.ndjson`] },
  { id: "4827", logs: [`${logs}/text/order-4827.log`], format: `${logs}/text/order-4827.format.yml` },
];

mkdirSync(join(root, out), { recursive: true });
for (const sample of samples) {
  let stdout = "";
  let stderr = "";
  const args = [
    "trace", "order-fulfilment", "--flows", "examples/order-fulfilment/flows", "--flow-revision", "git:3f2a9c1",
    "--orderId", sample.id, ...sample.logs.flatMap((file) => ["--logs", file]),
    ...(sample.format ? ["--log-format", sample.format] : []),
  ];
  const code = await run(args, { cwd: root, now: () => NOW, env: {}, stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  if (code !== 0) throw new Error(`order ${sample.id}: ${stderr}`);
  writeFileSync(join(root, out, `order-${sample.id}.run.json`), stdout);
  console.log(`order-${sample.id}.run.json  ${stderr.trim().split("\n").pop()}`);
}
