# Log adapters

Core only sees normalised events (`LogEvent` in `@flowmap/core`); each log backend is an adapter in
`@flowmap/adapters` behind one small interface:

```ts
interface LogAdapter {
  name: string;
  fetch(query: LogQuery): Promise<{ events: LogEvent[]; warnings: string[] }>;
}
```

`LogQuery` carries the flow's sources, the correlation key and value, the paths where the key sits
and an optional time window. An adapter may use them to narrow its search but may return more: the
engine filters by source, event name and correlation value. Lines an adapter cannot use are reported
in `warnings`, never dropped silently. Add a backend by implementing this interface; `core` does not
change.

## Normalised event

| Field | Meaning |
| --- | --- |
| `ts` | ISO 8601 with a time zone. |
| `source` | Compared with `evidence.source`. |
| `event` | Compared with `evidence.match.event`. |
| `attributes` | Object read by `attributes.<name>` paths. |
| `msg` | Optional one-liner for the timeline. |
| `ref` | URI of the raw line: `file://<name>#L<line>`, `loki://<source>?ts=<ns>`. |

## NDJSON (`--logs`)

One JSON object per line, from any backend's export. Canonical line:

```json
{"ts":"2026-10-31T09:03:00Z","source":"payments-api","event":"payment.declined","msg":"Card declined","attributes":{"order_id":"4821","amount":"€84.90"}}
```

Accepted aliases: `timestamp`, `time` or `@timestamp` for `ts`; `service` or `service_name` for
`source`; `event_name` for `event`; `message` for `msg`. Without an `attributes` object every other
field becomes an attribute. Timestamps are ISO 8601 with a zone, or epoch seconds/milliseconds.
Blank lines are ignored; lines that are not JSON or lack a timestamp, source or event name are
skipped with a warning naming file and line. Refs use the file's base name and 1-based line number.

```bash
flowmap trace order-fulfilment --orderId 4821 --logs export.ndjson > run.json
```

## Loki (`--loki-url`)

Reads `/loki/api/v1/query_range` for the flow's sources, narrowed to lines containing the id:
`{service=~"orders-api|inventory|..."} |= "4821"`, paging forward up to 20 pages of 5000 lines.

- Lines must be JSON objects with an `event` field (as for NDJSON). The source comes from the line,
  or from the stream label `--loki-label` (default `service`); the timestamp from the line, or from
  Loki. Plain-text lines carry no event name and are skipped with a warning.
- A search window is always sent: `--from` / `--to` take ISO 8601 or an age (`24h`, `7d`); the
  default is the last 7 days.
- `--loki-tenant` sets `X-Scope-OrgID`. Credentials come from the environment, never from flags:
  `FLOWMAP_LOKI_TOKEN` (bearer) or `FLOWMAP_LOKI_USER` + `FLOWMAP_LOKI_PASSWORD` (basic).
  `FLOWMAP_LOKI_URL` sets the URL. Credentials are never written into refs or output.

```bash
export FLOWMAP_LOKI_URL=https://loki.example.com FLOWMAP_LOKI_TOKEN=...
flowmap trace order-fulfilment --orderId 4821 --loki-label app --from 24h > run.json
```

The Loki adapter is covered by tests against a mocked HTTP client; it has not been run against a live
Loki server yet. Credentials cannot live in the browser, so the viewer does not talk to Loki: a small
server for live backends is a later addition.

## `flowmap trace`

```
flowmap trace <flow> --<correlationKey> <value> (--logs <file>... | --loki-url <url>) [options]
```

`<flow>` is a flow name (looked up under `--flows`, default `flows`) or a flow file; the identifier
flag is named after the flow's `correlationKey` (`--id` always works too). The run document goes to
stdout and a one-line summary to stderr. With `--json`, stdout is
`{ ok, run, summary: { eventsRead, eventsMatched, unexpected }, warnings }`, or
`{ ok: false, error: { code, message }, warnings }` on failure. Exit codes: `0` ok; `1` invalid flow
or no events matched the id; `2` usage, I/O or backend error.
