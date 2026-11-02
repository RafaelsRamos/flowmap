# Viewer

`packages/viewer` is a static web app (Vite, React, React Flow, ELK). There is no backend: files are
read in the browser and checked with the same `@flowmap/core` validators as `flowmap validate`.

```bash
npm install
npm run build                      # the viewer uses the built core and schema packages
npm run dev -w @flowmap/viewer     # http://localhost:5173/?example
npm run build:web -w @flowmap/viewer   # static site in packages/viewer/dist-web
```

## Loading

- **Drop** a folder or files anywhere on the page, or use the *Folder…* / *Files…* buttons.
- **A public GitHub repository**: `github.com/owner/repo`, or a `/tree/<branch>/<folder>` URL. Only
  YAML/JSON files in a `flow`/`flows` folder (or the named folder) are read, straight from the
  browser. `?repo=owner/repo` in the page URL opens one directly.
- **The example**: the *Example* button or `?example` opens `examples/order-fulfilment`.

YAML/JSON files without a `schemaVersion` are ignored, so a whole repo can be dropped. Files that
fail validation are listed under *Problems* with line and column. A `*.run.json` is shown under the
flow it names; runs are checked against that flow.

## Tracing logs you bring yourself

*Trace from logs* in the sidebar builds a run in the page, with the same engine as `flowmap trace`:
pick `.log`, `.txt` or `.ndjson` files or paste lines, enter the flow's correlation id and press
*Trace*. Nothing is uploaded. The run joins the run list and can be downloaded as `run.json`. Plain
text it cannot read on its own needs a custom format; see [adapters.md](adapters.md).

## Choosing the git tag

Under *Code links*, enter a github.com repository URL and pick one of its tags (the newest 100 are
listed). Code links then point at that tag. When the flows were opened from that same GitHub
repository (`?repo=` or the *Load* box), choosing a tag also re-reads the flow files at the tag, so the
graph and the code come from one version. Choosing "Run's revision, else HEAD" goes back to the
default. Only public repositories can be listed.

## Using it

1. **Graph**: layered top-to-bottom auto-layout. Without a run it is the design; with one, each
   step shows its status, taken transitions are green with a `×n` count, untaken ones fade, and
   unexpected transitions are dashed red. Self-loops (`retry`, `not home`) are drawn beside the node.
2. **Details**: click a step to expand it (extracted fields and the evidence timeline) and open its
   panel: description, service, log events and outcomes, the run's evidence with raw-log refs, and a
   code link. Code links need a repository URL (sidebar, remembered in the browser). They point at the
   **git tag** chosen in the sidebar; without one, at the run's `flowRevision: git:<sha>`, otherwise `HEAD`.
   When a run carries `raw` lines, the panel shows the actual log line under each evidence entry (the
   `ref` stays underneath), and a step reached by an unexpected transition shows the line that revealed it.
3. **Search**: label, id, service, description, code anchor and log event names, and, with a run
   loaded, the log lines the run recorded (raw line, message, event, extracted fields). Matching steps
   stay lit and the rest fades; the result list shows the log line around the match. Click a result
   to centre it.
4. **Subflows**: not implemented. The flow schema still reserves `subflows`, `subflow`, `fork` and
   `join`. The top bar has a breadcrumb where drill-down will go; the format is to be designed with
   step 3, once the matcher's semantics are known.

Opening another run closes every card and clears the selected step. An open card is as tall as its
content, and its left bar keeps the status colour (green success, red failed, yellow pending).
