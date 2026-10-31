# How a run is matched from logs

`flowmap trace` (and `matchRun` in `@flowmap/core`) turns a flow, log events and one correlation
value into a [run document](run-format.md). It is deterministic: the same flow and events always give
the same document. There is no AI, no `eval`, no clock and no I/O in the engine; `generatedAt` and
`flowRevision` are passed in.

## 1. Events

An adapter hands the engine normalised events: `ts`, `source`, `event`, `attributes`, an optional
`msg` and a `ref` back to the raw line (see [adapters.md](adapters.md)). Events are ordered by
instant (offsets are honoured); events with the same timestamp keep the order they were given in.
An event whose timestamp cannot be parsed makes the engine throw, since any order would be a guess.

## 2. Assigning events to nodes

An event belongs to a node when all of these hold:

- its `source` equals the node's `evidence.source`;
- its `event` is in `evidence.match.event`;
- the value at `evidence.match.correlate` equals the correlation value (compared as text, so the
  number `4821` matches `"4821"`).

One event may belong to several nodes (in the example, `delivery.signed` is evidence for both
*Out for delivery* and *Delivered*). Events that match no node are ignored. Nodes without `evidence`
never get events and are reported as `not_reached`, because logs cannot confirm them.

Each node's events become its `evidence` list, oldest first.

## 3. Edges taken

For an edge `from -> to` with an optional `when`, the *triggers* are the events at `from` named
`when` (any event at `from` when there is no `when`).

- **Between two nodes:** a trigger counts once if the target has an event at or after it and before
  the next trigger. `observed` is the number of such triggers.
- **A loop on one node** (`retry`, `not home`): a trigger counts only if the node has a later event.
  The last decline of a payment that gave up is therefore not a retry: three declines show
  `retry: 2`.

Only edges with `observed > 0` are listed, in the flow's edge order.

## 4. Unexpected transitions

For every node except `start`, the engine looks at the node's first event. If no declared edge into
the node has a trigger at or before it, the node was entered without a declared way in. The engine
reports `unexpected` from the node of the latest event before it, with the first event's `ts` and
`ref`.

Skipping a step is the typical case: a parcel dispatched with no `pack.completed` gives
`payment -> out-for-delivery`.

Limits, by design in v1:

- Only the first arrival at a node is checked, so a backward jump into a node already visited is not
  flagged.
- If the previous node and the new node are joined by a declared edge whose `when` did not hold
  (for example `stock.unavailable` followed by `pack.completed`), nothing is reported: the run
  validator requires `unexpected` entries to be pairs the flow does not declare. The edge is simply
  not counted as taken.
- If nothing precedes the first event (a log that starts mid-flow), nothing is reported.

## 5. Node status

- **With events:** the last event named in `outcome.success` or `outcome.failure` decides
  (`success` or `failure`). With `outcome` rules but none of those events yet the node is `pending`.
  A node with evidence but no `outcome` at all is `success` once it has any event.
- **Without events:** `pending` if some edge into the node (other than a loop) has a trigger, i.e. the
  flow could have moved on to it; otherwise `not_reached`.

A stuck order is therefore visible as a `pending` node: *Pick & pack* after a payment was approved
and nothing was packed. When several edges lead into a node the engine treats them as alternatives
(any one is enough); fork/join semantics stay reserved in the flow format.

## 6. Display fields

`evidence.display` expressions run over the node's events (all matched events, oldest first):

| Expression | Value |
| --- | --- |
| `attributes.a.b`, `ts`, `event` | The value from the **latest** event that has it (shorthand for `last(...)`). |
| `last(path)` / `first(path)` | The value from the latest / earliest event where the path is present and not null. |
| `count(name)` | How many of the node's events are named `name`. |

A path that no event has gives `null`; a nested object or list is rendered as JSON text. Paths are
only `ts`, `event` or `attributes` followed by object keys: no indexing, no wildcards, nothing is
evaluated. Nodes with no events get no `fields`.

## Output

Every flow node appears in `nodes`; `edges` and `unexpected` are always present. The CLI checks its
own output with `validateRunSource` against the flow before printing it.
