# Log adapters

Everything in the package except file access (`@flowmap/adapters/node`) also runs in a browser.
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
| `raw` | The log line itself (cut at 4000 characters). Copied into the run's evidence so the viewer shows the real log, not just a pointer. Leave it out with `--no-raw`. |

## NDJSON (`--logs file.ndjson`)

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

## Plain-text logs (`.log`, `.txt`)

Anything that is not `.ndjson`/`.jsonl` is read as text, line by line. The first reader that
understands a line wins:

1. **A JSON object**, alone or after a timestamp and level
   (`2026-10-31T09:00:00Z INFO {"event":"order.placed","attributes":{"order_id":"4821"}}`).
2. **Your pattern**, if the log format has one (below).
3. **A timestamp, then `key=value` pairs and a message** (logfmt):
   `2026-10-31T09:03:00Z WARN service=payments-api event=payment.declined order_id=4821 msg="Card declined"`.
   `event=` names the event; `service=` or `source=` names the source; every other pair is an attribute.

The source of a line that names none is the file's name without its extension
(`payments-api.log` gives `payments-api`), or `--source`. Timestamps without a time zone are taken as
UTC unless the log format sets `timezone`, and the trace says so. Lines that yield no event
(stack-trace continuations, noise) are not errors: each file gets one warning counting them.

For free text such as `Card declined for order 4821`, describe it in a small JSON or YAML **log format**
file, passed with `--log-format` (see `examples/order-fulfilment/logs/text/order-4840.format.yml`):

```yaml
pattern: '^(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) +(?<level>\w+) +\[(?<source>[\w-]+)\] (?<msg>.*)$'
timezone: "+01:00"            # UTC (default), Z, or an offset
events:                        # name an event from the message; named groups become attributes
  - { match: 'Card declined for order (?<order_id>\d+)', event: payment.declined }
```

| Key | Meaning |
| --- | --- |
| `pattern` | Regex with named groups. `ts`, `source`, `event`, `msg` fill those fields; other groups become attributes. |
| `events` | `{ match, event }` rules tried on the message when the line has no `event`; the first match wins and its named groups become attributes (this is how the order id gets out of the sentence). |
| `source` | Source for lines that name none. |
| `timezone` | Zone of timestamps written without one. |

```bash
flowmap trace order-fulfilment --orderId 4840 --logs order-4840.log --log-format order-4840.format.yml > run.json
```

The viewer can do the same with no CLI: *Trace from logs* in the sidebar takes files or pasted lines
and an id, runs the engine in the page and shows the result (nothing is uploaded). Pasted text has no
file name, so its lines must name a source (`source=...`, or `source:` in the custom format).

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
