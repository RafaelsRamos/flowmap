# Flowmap (working name)

Flowmap turns flow files kept in a product's repo into an explorable graph, and overlays what a
single real instance did using its logs as evidence. The full plan lives in the
"Flowmap — Development Plan" doc; this repo follows its six-step build order.

| Step | What | Status |
| --- | --- | --- |
| 1 | Flow schema and validator (`flowmap validate`) | done |
| 2 | Viewer (plus run schema) | done |
| 3 | Deterministic log overlay | not started |
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
complete order with `retry` and `not home` loops, a stuck order, an unexpected transition) are in
`examples/order-fulfilment/flows/examples/`.

## Layout

```
packages/
  schema/   flow.schema.json and run.schema.json (JSON Schema 2020-12) and a tiny module exporting them
  core/     parse + validate flows and runs: pure functions, no I/O
  cli/      the `flowmap` command (all file I/O lives here)
  viewer/   Vite + React + React Flow + ELK static web app
examples/
  order-fulfilment/
    flows/          the valid example flow
    flows/examples/ hand-written sample runs (*.run.json)
    flows-broken/   one deliberately broken file per validator rule (flows and runs)
docs/       flow and run format references, viewer guide, AGENTS.md snippet
```

`adapters/`, `mcp/` and `action/` from the plan arrive with their steps.

## Develop

```bash
npm test        # builds, then runs vitest
```

Licensed under [Apache-2.0](LICENSE).

See [docs/flow-format.md](docs/flow-format.md) for the flow file format and every validator rule, and
[docs/agents-snippet.md](docs/agents-snippet.md) for the text product repos add to `AGENTS.md` /
`CLAUDE.md`.
