# Flowmap (working name)

Flowmap turns flow files kept in a product's repo into an explorable graph, and overlays what a
single real instance did using its logs as evidence. The full plan lives in the
"Flowmap — Development Plan" doc; this repo follows its six-step build order.

| Step | What | Status |
| --- | --- | --- |
| 1 | Flow schema and validator (`flowmap validate`) | in progress, see below |
| 2 | Viewer (plus run schema) | not started |
| 3 | Deterministic log overlay | not started |
| 4 | Agent analysis | not started |
| 5 | CI drift check (`flowmap check`) | not started |
| 6 | MCP server | not started |

## Step 1: validate a flow

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

## Layout

```
packages/
  schema/   flow.schema.json (JSON Schema 2020-12) and a tiny module exporting it
  core/     parse + validate: pure functions, no I/O
  cli/      the `flowmap` command (all file I/O lives here)
examples/
  order-fulfilment/
    flows/          the valid example flow
    flows-broken/   one deliberately broken file per validator rule
docs/       flow format reference, AGENTS.md snippet
```

`viewer/`, `adapters/`, `mcp/` and `action/` from the plan arrive with their steps.

## Develop

```bash
npm test        # builds, then runs vitest
```

See [docs/flow-format.md](docs/flow-format.md) for the file format and every validator rule, and
[docs/agents-snippet.md](docs/agents-snippet.md) for the text product repos add to `AGENTS.md` /
`CLAUDE.md`.
