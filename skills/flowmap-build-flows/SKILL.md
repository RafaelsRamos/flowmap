---
name: flowmap-build-flows
description: Builds or updates Flowmap flow files (flows/*.yml) for a repository by reading its code - the steps and transitions of a product flow such as order fulfilment or sign-up, and the log events that prove each step happened. Use when asked to document, map or model a product flow, to create or extend flows for Flowmap, to add flows to a repo, or when a change adds, removes or renames a step, transition or log event and the flow files must follow. Also use before tracing an instance with `flowmap trace` if no flow exists yet.
---

# Build Flowmap flows for a repository

A Flowmap **flow file** says what *can* happen in a product flow (steps and transitions) and how to
recognise evidence of each step in logs (source, event names, where the correlation id sits). It never
holds logs. Your job: read the repository and write flow files that are **true to the code**, then
prove they are well-formed with the validator.

Read `reference.md` (next to this file) for the exact format and every validator rule, and start from
`flow-template.yml`. The repository `RafaelsRamos/flowmap` has a full example at
`examples/order-fulfilment/flows/order-fulfilment.yml`.

## Ground rules

1. **Never invent evidence.** Every event name in `match.event` must be an event the code really
   logs, found by search. Every `code:` anchor must be a real file (and symbol). If you cannot find the
   log line for a step, leave that node **without** `evidence` and list it as a gap. A flow that is
   honest and incomplete beats one that looks complete and is wrong.
2. **Observed in code, not guessed from names.** A transition exists because code moves from one step
   to the next (a call, a published message, a status change, a handler subscribed to an event), not
   because two things sound related.
3. **Read-only on the product code.** Create or edit only `flows/` (and `AGENTS.md`/`CLAUDE.md` for the
   snippet). Do not change application code to add log lines; list them as recommendations instead.
4. **No personal data.** Do not copy real ids, names, emails or log lines from the repo, tickets or logs
   into the flow files or your report. Use the attribute *names*, never values.
5. **Do not use reserved features.** `subflows`, `subflow`, `fork` and `join` are rejected by the
   validator. Model parallel branches as several edges leaving one node, as the example does.
6. **Ask before big guesses.** If the repo has many candidate flows, propose the list (step 2) and let
   the user pick before writing more than one or two.

## Procedure

### 1. Orient

- Look for existing flows (`flows/`, `*.flow.yml`), an `AGENTS.md`/`CLAUDE.md`, and architecture docs.
  Update existing flows rather than creating duplicates.
- Find how to run the validator: `npx flowmap validate flows/` (or the path of a Flowmap checkout:
  `node <flowmap>/packages/cli/dist/index.js validate flows/`). If it is unavailable, say so and still
  write the files; do not claim they are validated.
- Learn the repo's shape: services/modules, languages, how it logs, how services talk (HTTP, queues,
  topics, DB status columns).

### 2. Find candidate flows

Look for processes that move one *instance* (an order, a payment, a user, a shipment) through several
steps, usually across services:

- status enums and state machines (`OrderStatus`, `State`, transitions tables, `when (status)`);
- message/event handlers and publishers (Kafka, SQS, RabbitMQ, outbox tables, `@EventListener`);
- sagas, workflows and job pipelines (Temporal, Step Functions, Camunda, Airflow, cron chains);
- request handlers that call one another in sequence, with retries and failure branches.

Prefer **business journeys** a product owner would name. Keep each flow to roughly 4-15 steps; split
bigger ones. One `correlationKey` per flow (the id carried by every step: `orderId`, `paymentId`...).
Present the candidates (name, one-line scope, where in the code) and confirm with the user when there
are more than two.

### 3. Model one flow

For the flow you are writing:

- **Steps (nodes):** one per meaningful state or action, with a stable kebab-case `id` (never derived
  from a label you may rename), a short human `label`, a one-line `description`, the `service` that
  does it, and a `code` anchor `path/to/file.ext#symbol` to the handler or function that performs it.
- **Start and end:** `start` is where every instance begins; `end` lists every terminal state,
  *including failure endings* (cancelled, refunded, dead-lettered).
- **Transitions (edges):** `from`, `to`, an optional `label` (`retry`, `paid`, `not home`) and `when`
  (the event that triggers the move). Include **retry loops** (an edge from a node to itself) and
  **failure branches**, not only the happy path. Where the code branches on an outcome, add one edge
  per branch with its own `when`.
- Make sure the graph validates: every node reachable from `start`, every node without an exit listed
  in `end`.

### 4. Attach evidence (what makes a step visible in logs)

For each node you can confirm in logs, add `evidence`:

- **`source`**: the log source exactly as it appears in the log backend (often the service name). Find
  it in logging config, `service.name`/`app` labels, deployment manifests, or the logger name. If it
  differs between environments, use the production value and note it.
- **`match.event`**: the event names the code logs for this step, copied from the log calls. Search the
  code (`rg 'logger\.|log\.|slog\.|logging\.|Timber\.|console\.'` plus the event name) and open each
  hit. Event names must match `[A-Za-z0-9_][A-Za-z0-9_.:-]*`.
- **`match.correlate`**: the path where the correlation id sits in the log event, e.g.
  `attributes.order_id`. Read the log call (or the logging context/MDC set up for the request) to see
  the real field name; it is often snake_case even when the flow key is camelCase.
- **`outcome`**: which event means success and which means failure (`success: payment.approved`,
  `failure: payment.declined`). Both must be in `match.event`.
- **`display`** (optional): short fields for the expanded node, written with the tiny syntax only:
  `attributes.amount`, `first(attributes.x)`, `last(event)`, `count(<event>)`.

If the code logs **sentences instead of event names** (`"Card declined for order 17"`), do not put the
sentence in the flow. Recommend adding a structured `event` field to those log calls (list the exact
file and line), or, when the user cannot change the code, write a log format file mapping messages to
event names (see `docs/adapters.md` in the Flowmap repo, "Plain-text logs"). Until then leave the node
without `evidence`.

Edges: make each edge's `when` an event in the *source* node's `match.event`, or the validator warns.

### 5. Write the file

- Path: `flows/<flow-name>.yml`; `flow:` is that name, kebab-case.
- First line: the schema comment from `flow-template.yml` so editors autocomplete.
- Keep the node order in the order an instance meets them; one edge per line.

### 6. Validate and fix

Run `flowmap validate flows/` and fix every **error**; read each **warning** and either fix it or
justify it in your report. Typical fixes: unreachable node (missing edge), undeclared terminal (add to
`end`), `outcome` event not in `match.event`, wrong id casing.

### 7. Check against reality (when logs are available)

If the user can give a sample log for one instance (an NDJSON/`.log` export, or a Loki query), run
`flowmap trace <flow> --<correlationKey> <id> --logs <file>` and read the result:

- a step you know happened shows `not_reached` -> its `source`, `event` or `correlate` is wrong;
- an `unexpected` transition -> a missing edge in the flow (or a real conformance gap: say which);
- `pending` where the instance finished -> a missing outcome event.

Fix the flow, rerun, and say in the report that it was checked against a sample (and what sample).

### 8. Make it stick

If `AGENTS.md`/`CLAUDE.md` has no flows section, add the snippet from `docs/agents-snippet.md` of the
Flowmap repo (below) so future changes keep the flows current:

```markdown
## Product flows
This repo documents its product flows in `flows/*.yml` (schema: https://raw.githubusercontent.com/RafaelsRamos/flowmap/main/packages/schema/flow.schema.json).
When a change adds, removes or renames a step, a transition or a log event,
update the matching flow file in the same change and run `npx flowmap validate flows/`.
```

## Report back

Finish with a short report, not a transcript:

- **Flows written or changed** (file, one line each) and the validator result (command and outcome).
- **Evidence coverage:** nodes with evidence vs without; for each node without, why (no log line found,
  free-text logs, other).
- **Assumptions and uncertain edges**, each with the file you based it on.
- **Recommendations:** log lines worth adding (file:line, suggested event name and attribute), anchors
  that could not be verified.
- **Questions** you could not answer from the code.

Do not commit or push unless asked.

## Updating an existing flow after a code change

Read the diff, find the step, transition or log event it touches, and change only the matching nodes,
edges and evidence. Renaming a label never changes an `id`. Removing a step means removing its node
and every edge that references it. Rerun `flowmap validate`.
