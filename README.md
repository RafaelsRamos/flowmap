# Flowmap (working name)

Flowmap turns flow files kept in a product's repo into an explorable graph, and overlays what a
single real instance did using its logs as evidence. The full plan lives in the
"Flowmap — Development Plan" doc; this repo follows its six-step build order.

| Step | What | Status |
| --- | --- | --- |
| 1 | Flow schema and validator (`flowmap validate`) | done |
| 2 | Viewer (plus run schema) | done |
| 3 | Deterministic log overlay (`flowmap trace`) | done |
| 4 | Agent analysis | not started |
| 5 | CI drift check (`flowmap check`) | not started |
| 6 | MCP server | not started |

## Step 1: validate a flow (done)

```bash
npm install
npm run build
node packages/cli/dist/index.js validate examples/order-fulfilment/flows
```

```
✔ no problems in 1 file
```

A broken file fails with the file, line and column:

```
flows-broken/unknown-property.yml:21:5  error  unknown property "servce" in nodes[1] (did you mean "service"?)  [unknown-property]
```

Add `--json` for machine-readable output. Exit codes: `0` no errors (warnings allowed), `1`
validation errors, `2` usage or I/O error.

## Step 2: view a flow and a run (done)

```bash
npm run build
npm run dev -w @flowmap/viewer     # then open http://localhost:5173/?example
```

The viewer renders the flow as a graph, overlays a run document (statuses, extracted fields, an
evidence timeline, observed and unexpected transitions), and has a detail panel, search and a
path-finder between any two steps. Drop a folder on it, or point it at a public GitHub repo. See
[docs/viewer.md](docs/viewer.md) and [docs/run-format.md](docs/run-format.md). Sample runs (a
complete order with `retry` and `not home` loops, a stuck order, an unexpected transition, a payment
declined for good, a parcel nobody is home for) are in
`examples/order-fulfilment/flows/examples/`.

## Step 3: trace an instance from its logs (done)

```bash
npm run build
node packages/cli/dist/index.js trace order-fulfilment --flows examples/order-fulfilment/flows \
  --orderId 4821 --logs examples/order-fulfilment/logs/order-4821.ndjson > run.json
```

```
✔ traced orderId 4821: 10 of 12 events matched, 0 unexpected transitions
```

The matching engine is a pure function in `@flowmap/core` (`matchRun`): flow + events + correlation
value to a run document, no AI. Backends are adapters in `@flowmap/adapters`: NDJSON files and Loki.
Open `run.json` in the viewer to see the path lit up. Rules: [docs/matching.md](docs/matching.md);
backends and flags: [docs/adapters.md](docs/adapters.md). Sample logs with their expected runs
(retry loop, stuck order, unexpected transition) are in `examples/order-fulfilment/logs/`.

## Layout

```
packages/
  schema/   flow.schema.json and run.schema.json (JSON Schema 2020-12) and a tiny module exporting them
  core/     parse + validate flows and runs, match logs to a run: pure functions, no I/O
  adapters/ log backends: NDJSON files, Loki (normalised events with a ref to the raw line)
  cli/      the `flowmap` command (validate, trace)
  viewer/   Vite + React + React Flow + ELK static web app
examples/
  order-fulfilment/
    flows/          the valid example flow
    flows/examples/ hand-written sample runs (*.run.json)
    flows-broken/   one deliberately broken file per validator rule (flows and runs)
    logs/           sample NDJSON logs with the run each must produce (golden tests)
docs/       flow and run format references, viewer guide, AGENTS.md snippet
```

`mcp/` and `action/` from the plan arrive with their steps.

## Develop

```bash
npm test        # builds, then runs vitest
```

Licensed under [Apache-2.0](LICENSE).

See [docs/flow-format.md](docs/flow-format.md) for the flow file format and every validator rule, and
[docs/agents-snippet.md](docs/agents-snippet.md) for the text product repos add to `AGENTS.md` /
`CLAUDE.md`.
