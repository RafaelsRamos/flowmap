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

## Using it

1. **Graph**: layered top-to-bottom auto-layout. Without a run it is the design; with one, each
   step shows its status, taken transitions are green with a `×n` count, untaken ones fade, and
   unexpected transitions are dashed red. Self-loops (`retry`, `not home`) are drawn beside the node.
2. **Details**: click a step to expand it (extracted fields and the evidence timeline) and open its
   panel: description, service, log events and outcomes, the run's evidence with raw-log refs, and a
   code link. Code links need a repository URL (sidebar, remembered in the browser); with a run that has
   `flowRevision: git:<sha>` they point at that commit, otherwise `HEAD`.
3. **Search**: label, id, service, description, code anchor and log event names. Matches stay lit,
   the rest fades; click a result to centre it.
4. **Paths** tab: pick two steps (dropdowns or click them on the graph) to see every simple path
   between them. With a run loaded, each path says whether the run took it. Click a path to isolate it.
5. **Subflows**: not implemented. The flow schema still reserves `subflows`, `subflow`, `fork` and
   `join`. The top bar has a breadcrumb where drill-down will go; the format is to be designed with
   step 3, once the matcher's semantics are known.
