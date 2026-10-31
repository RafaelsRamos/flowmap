# Flow file format (v1)

A flow file is YAML or JSON (both parse to the same model) kept in the product repo, usually under
`flows/`. It describes what *can* happen and how to recognise evidence of it in logs. It never
contains logs. See `examples/order-fulfilment/flows/order-fulfilment.yml`.

The schema is `packages/schema/flow.schema.json` (JSON Schema draft 2020-12). For editor
autocomplete in YAML add, as the first line:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/RafaelsRamos/flowmap/main/packages/schema/flow.schema.json
```

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Always `1`. |
| `flow` | yes | Stable kebab-case name. |
| `description` | no | One line. |
| `correlationKey` | yes | Name of the identifier tying one instance's events together, e.g. `orderId`. |
| `start` | yes | Id of the first node. |
| `end` | yes | Ids of terminal nodes (at least one). |
| `nodes` | yes | At least one node. |
| `edges` | yes | Transitions (may be empty for a single-node flow). |

## Node

`id` (stable, kebab-case, never changes when the label does) and `label` are required. Optional:
`description`, `service`, `code` (`path/to/file.ext` or `path/to/file.ext#symbol`; existence is
checked by the step 5 drift check, only the shape is checked now) and `evidence`.

### Evidence

```yaml
evidence:
  source: payments-api                 # log source
  match:
    event: [payment.attempted, payment.declined, payment.approved]
    correlate: attributes.order_id     # where the correlation key sits in an event
  outcome:                             # events -> node status (each must be in match.event)
    success: payment.approved
    failure: payment.declined
  display:                             # fields shown in the expanded node
    Amount: attributes.amount
    Attempts: count(payment.attempted)
```

Expressions are deliberately tiny, never `eval`:

- a path: `attributes.<name>[.<name>...]`, `ts` or `event`
- `first(<path>)` / `last(<path>)`
- `count(<event name>)` (the event must be in `match.event`)

`first`/`last` taking a path is a refinement of the draft in the plan; step 3 gives them semantics.
Nodes without `evidence` are allowed: they render but cannot be confirmed from logs.

## Edge

`from`, `to` (node ids), optional `label` and `when` (the event that triggers the transition).

## Reserved for later

These are rejected today with a "reserved for a future version" message so files written now stay
valid when the features arrive: top-level `subflows`; on nodes `subflow`, `fork`, `join`.

## What `flowmap validate` checks

Structural (the JSON Schema): required fields, types, kebab-case ids, event-name and expression
syntax, code anchor shape, no unknown properties (with a "did you mean" hint). Semantic (only run
on a structurally valid file):

| Code | Severity | Rule |
| --- | --- | --- |
| `duplicate-node-id` | error | Node ids are unique. |
| `unknown-node` | error | `start`, `end` entries and edge `from`/`to` name existing nodes. |
| `duplicate-end` | error | A node appears once in `end`. |
| `unreachable-node` | error | Every node is reachable from `start`. |
| `undeclared-terminal` | error | A node with no exit (self-loops don't count) is listed in `end`. |
| `outcome-event-not-matched` | error | `outcome` events appear in `match.event`. |
| `display-event-not-matched` | error | `count(event)` events appear in `match.event`. |
| `end-has-exits` | warning | An `end` node has edges leading out. |
| `duplicate-edge` | warning | Same `from`, `to` and `when` twice. |
| `edge-event-not-matched` | warning | An edge's `when` isn't in the source node's `match.event`. |

Other codes: `syntax`, `empty-file`, `missing-property`, `unknown-property`, `reserved-property`,
`wrong-type`, `invalid-value`.
