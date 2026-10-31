# AGENTS.md / CLAUDE.md snippet for product repos

Paste this into the `AGENTS.md` or `CLAUDE.md` of any repo that keeps Flowmap flow files. Replace
`<schema URL>` once the schema is published (see the open point in the README).

```markdown
## Product flows
This repo documents its product flows in `flows/*.yml` (schema: <schema URL>).
When a change adds, removes or renames a step, a transition or a log event,
update the matching flow file in the same change and run `npx flowmap validate flows/`.
```

Step 5 adds `flowmap check` (anchors, events and drift against the code). When it ships, change the
last line to `npx flowmap check`; CI then enforces the rule instead of relying on the instruction.
