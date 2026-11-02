# Flow file reference (v1)

Full docs: `docs/flow-format.md` and `docs/matching.md` in the Flowmap repo
(github.com/RafaelsRamos/flowmap). This is the part you need while writing flows.

## Shape

```yaml
schemaVersion: 1
flow: order-fulfilment            # kebab-case
description: One line.            # optional
correlationKey: orderId           # plain name: letters, digits, underscore
start: order-placed               # node id
end: [delivered]                  # at least one node id
nodes: [ ... ]                    # at least one
edges: [ ... ]                    # may be empty only for a single-node flow
```

### Node

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable kebab-case (`payment-retry`). Never changes when the label does. |
| `label` | yes | Human name. |
| `description` | no | One line. |
| `service` | no | The service/module that performs the step. |
| `code` | no | `path/to/file.ext` or `path/to/file.ext#symbol`; must exist in the repo. |
| `evidence` | no | Rules for finding the step in logs. Without it the node is drawn but never confirmed. |

### Evidence

```yaml
evidence:
  source: payments-api                 # log source as the backend/file names it
  match:
    event: [payment.attempted, payment.declined, payment.approved]   # each [A-Za-z0-9_][A-Za-z0-9_.:-]*
    correlate: attributes.order_id     # where the correlation id sits in one log event
  outcome:                             # optional; each event must be in match.event
    success: payment.approved
    failure: payment.declined
  display:                             # optional; label -> expression
    Amount: attributes.amount          # bare path = last(path)
    First seen: first(ts)
    Attempts: count(payment.attempted) # event must be in match.event
    Status: last(event)
```

Paths are `ts`, `event`, or `attributes.<name>[.<name>...]`. Nothing else is evaluated.

### Edge

`from`, `to` (node ids), optional `label`, optional `when` (the event that triggers the transition).
A loop on one node (`from` = `to`) is a retry. Parallel branches are several edges out of one node.

### Reserved (rejected for now)

`subflows` at top level; `subflow`, `fork`, `join` on nodes.

## What the validator checks (`flowmap validate flows/`)

Structure first (types, required fields, kebab-case ids, event-name syntax, no unknown properties),
then, on a structurally valid file:

| Code | Severity | Fix |
| --- | --- | --- |
| `duplicate-node-id` | error | Make ids unique. |
| `unknown-node` | error | `start`, `end` and edge ends must name existing nodes. |
| `duplicate-end` | error | List each end node once. |
| `unreachable-node` | error | Add the missing edge from `start`, or remove the node. |
| `undeclared-terminal` | error | A node with no exit (self-loops do not count) must be in `end`. |
| `outcome-event-not-matched` | error | Add the outcome event to `match.event`. |
| `display-event-not-matched` | error | `count(event)` needs the event in `match.event`. |
| `end-has-exits` | warning | An `end` node has outgoing edges; remove them or the `end` entry. |
| `duplicate-edge` | warning | Same `from`, `to`, `when` twice. |
| `edge-event-not-matched` | warning | An edge's `when` is not in the source node's `match.event`. |

## How a flow is used (so you model for it)

`flowmap trace` takes one instance's log events and walks them over the flow:

- An event belongs to a node if its source equals `evidence.source`, its name is in `match.event`
  and the value at `match.correlate` equals the instance id. One event can serve several nodes.
- An edge is **taken** when a trigger event at its source (`when`, or any event if it has none) is
  followed by an event at its target. A loop counts only if the node has a later event.
- A node first reached with no taken edge into it is an **unexpected transition**: the flow is
  missing an edge, or the system did something it should not.
- Status: the last `outcome` event decides success/failure; events but no outcome yet is `pending`;
  no events is `pending` if some edge into the node was triggered, else `not_reached`.

So write `when` as the event that *leaves* the source step, and give every step that can be seen in
logs its own events; shared events (two nodes matching the same event) are fine.

## Finding log calls, by stack

Search for the logger first, then the event name. Common patterns:

| Stack | Look for |
| --- | --- |
| Kotlin/Java | `logger.info(`, `log.warn(`, `Timber.`, `kv("event"`, `MDC.put(` (correlation ids) |
| JS/TS | `logger.info(`, `log.info({ event:`, pino/winston calls, `console.log(` |
| Python | `logger.info(`, `structlog`, `extra={...}`, `logging.getLogger(` |
| Go | `slog.Info(`, `zap.`, `logrus.WithField(`, `log.Printf(` |
| Messaging | topic/queue names, `@KafkaListener`, `@SqsListener`, `publish(`, outbox inserts |
| State | status enums, `UPDATE ... SET status`, state-machine tables |

The correlation id is usually put into a logging context once per request/message (MDC, `AsyncLocalStorage`,
`contextvars`, `slog.With`); read that setup to learn the real attribute name.
