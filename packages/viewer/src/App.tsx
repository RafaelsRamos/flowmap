import type { Run } from "@flowmap/core";
import { MarkerType } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailPanel } from "./components/DetailPanel.js";
import { FlowCanvas } from "./components/FlowCanvas.js";
import type { FlowFlowEdge } from "./components/FlowEdge.js";
import { Sidebar } from "./components/Sidebar.js";
import type { StepFlowNode } from "./components/StepNode.js";
import { exampleFiles } from "./lib/example.js";
import { readDropped, readFileList } from "./lib/files.js";
import { fetchRepoFiles, parseRepoSpec, repoWebUrl } from "./lib/github.js";
import { buildGraph } from "./lib/graph.js";
import { layoutGraph, type Position } from "./lib/layout.js";
import { searchNodes } from "./lib/search.js";
import { EMPTY_WORKSPACE, buildWorkspace, runTitle, runsForFlow, type SourceFile, type Workspace } from "./lib/workspace.js";

const REPO_KEY = "flowmap.repoUrl";

function storedRepoUrl(): string {
  try {
    return localStorage.getItem(REPO_KEY) ?? "";
  } catch {
    return "";
  }
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [flowPath, setFlowPath] = useState<string>();
  const [runPath, setRunPath] = useState<string>();
  const [repoUrl, setRepoUrl] = useState(storedRepoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ id: string; token: number }>();

  const loaded = workspace.flows.find((candidate) => candidate.path === flowPath);
  const flow = loaded?.flow;
  const loadedRun = workspace.runs.find((candidate) => candidate.path === runPath);
  const run = loadedRun?.run;

  const open = useCallback((files: SourceFile[]) => {
    const next = buildWorkspace(files);
    setWorkspace(next);
    const first = next.flows[0];
    setFlowPath(first?.path);
    setRunPath(first ? runsForFlow(next, first.flow)[0]?.path : undefined);
    setExpanded(new Set());
    setSelectedId(undefined);
    setQuery("");
    setError(next.flows.length === 0 && next.problems.length === 0 ? "No flow files found. Flow files have a schemaVersion." : undefined);
  }, []);

  const openRepo = useCallback(
    async (input: string) => {
      const spec = parseRepoSpec(input);
      if (spec === undefined) {
        setError("Enter a GitHub repository such as github.com/owner/repo.");
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const files = await fetchRepoFiles(spec);
        open(files);
        setRepoUrl((current) => current || repoWebUrl(spec));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [open],
  );

  useEffect(() => {
    try {
      localStorage.setItem(REPO_KEY, repoUrl);
    } catch {
      /* storage can be unavailable; the field still works for this visit */
    }
  }, [repoUrl]);

  // Deep links: ?example opens the bundled example, ?repo=owner/repo reads a public repository.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("example")) open(exampleFiles());
    const repo = params.get("repo");
    if (repo) void openRepo(repo);
  }, [open, openRepo]);

  // Dropping a folder or files anywhere on the page opens them.
  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") ?? false;
    const over = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent): void => {
      if (!hasFiles(event) || event.dataTransfer === null) return;
      event.preventDefault();
      setDragging(false);
      void readDropped(event.dataTransfer).then(open);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [open]);

  // A run traced from logs the user supplied lives in memory next to the loaded runs.
  const addTracedRun = (traced: Run): void => {
    const path = `traced/${traced.flow}-${Object.values(traced.correlation).join("-")}.run.json`;
    setWorkspace((current) => ({ ...current, runs: [...current.runs.filter((existing) => existing.path !== path), { path, run: traced, issues: [] }] }));
    selectRun(path);
  };

  // Opening another run starts from a clean canvas: every card closed, no step selected.
  const selectRun = (path: string | undefined): void => {
    setRunPath(path);
    setExpanded(new Set());
    setSelectedId(undefined);
  };

  const selectFlow = (path: string): void => {
    const next = workspace.flows.find((candidate) => candidate.path === path);
    setFlowPath(path);
    setRunPath(next ? runsForFlow(workspace, next.flow)[0]?.path : undefined);
    setExpanded(new Set());
    setSelectedId(undefined);
    setQuery("");
  };

  const graph = useMemo(() => (flow ? buildGraph(flow, run, expanded) : undefined), [flow, run, expanded]);

  // Layout is asynchronous (ELK runs in a worker-like promise); keep the last positions meanwhile.
  const [layout, setLayout] = useState<{ key: string; positions: Map<string, Position> }>();
  const viewKey = `${flowPath ?? ""}|${runPath ?? ""}`;
  useEffect(() => {
    if (graph === undefined) {
      setLayout(undefined);
      return;
    }
    let cancelled = false;
    void layoutGraph(
      graph.nodes.map((node) => ({ id: node.id, width: node.data.width, height: node.data.height })),
      graph.edges,
    ).then((positions) => {
      if (!cancelled) setLayout({ key: viewKey, positions });
    });
    return () => {
      cancelled = true;
    };
  }, [graph, viewKey]);

  const hits = useMemo(() => (flow ? new Set(searchNodes(flow, query).map((hit) => hit.id)) : new Set<string>()), [flow, query]);
  const searching = query.trim() !== "";

  const nodes = useMemo<StepFlowNode[]>(() => {
    if (!graph) return [];
    return graph.nodes.map((node) => {
      const id = node.id;
      const dimmed = searching && !hits.has(id);
      return {
        id,
        type: "step",
        position: layout?.positions.get(id) ?? { x: 0, y: 0 },
        data: { ...node.data, dimmed, matched: searching && hits.has(id), selected: id === selectedId },
        draggable: false,
      };
    });
  }, [graph, layout, searching, hits, selectedId]);

  const edges = useMemo<FlowFlowEdge[]>(() => {
    if (!graph) return [];
    const heights = new Map(graph.nodes.map((node) => [node.id, node.data.height]));
    return graph.edges.map((edge) => {
      const [sourceHandle, targetHandle] = handlesFor(edge.source, edge.target, edge.data.selfLoop, layout?.positions, heights);
      const dimmed =
        (searching && !(hits.has(edge.source) && hits.has(edge.target))) ||
        (run !== undefined && !searching && edge.data.kind === "declared" && edge.data.observed === 0);
      const color = edge.data.kind === "unexpected" ? "var(--unexpected)" : edge.data.observed ? "var(--taken)" : "var(--edge)";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle,
        targetHandle,
        type: "flow",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        data: { ...edge.data, dimmed },
      };
    });
  }, [graph, layout, searching, hits, run]);

  const onNodeClick = (id: string): void => {
    setSelectedId(id);
    setExpanded((current) => {
      const next = new Set(current);
      if (id === selectedId && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const searchHits = flow && searching ? searchNodes(flow, query) : [];
  const selectedNode = flow?.nodes.find((node) => node.id === selectedId);

  return (
    <div className="app">
      <Sidebar
        workspace={workspace}
        flowPath={flowPath}
        runPath={runPath}
        repoUrl={repoUrl}
        busy={busy}
        error={error}
        onFiles={(files) => void readFileList(files).then(open)}
        onExample={() => open(exampleFiles())}
        onRepo={(url) => void openRepo(url)}
        onFlow={selectFlow}
        onRun={selectRun}
        onTraced={addTracedRun}
        onRepoUrl={setRepoUrl}
      />

      <main className="stage">
        {flow && graph ? (
          <>
            <header className="topbar">
              <nav className="breadcrumb" aria-label="Flow scope">
                <span className="crumb current">{flow.flow}</span>
              </nav>
              <div className="search">
                <input
                  type="search"
                  placeholder="Search steps, services, events, code…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("");
                    if (event.key === "Enter" && searchHits[0]) setFocus({ id: searchHits[0].id, token: Date.now() });
                  }}
                  aria-label="Search"
                />
                {searching && (
                  <ul className="search-results" role="listbox">
                    {searchHits.length === 0 && <li className="muted">No matching step</li>}
                    {searchHits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setFocus({ id: hit.id, token: Date.now() });
                            setSelectedId(hit.id);
                          }}
                        >
                          {flow.nodes.find((node) => node.id === hit.id)?.label}
                          <span className="muted small"> {hit.reason}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="run-info">
                {run ? (
                  <>
                    <b>{loadedRun ? runTitle(loadedRun.run) : ""}</b>
                    {run.flowRevision && <span className="muted"> · {run.flowRevision}</span>}
                    {run.unexpected.length > 0 && <span className="chip status-unexpected">{run.unexpected.length} unexpected</span>}
                  </>
                ) : (
                  <span className="muted">Design view</span>
                )}
              </div>
            </header>

            <div className="canvas">
              {layout ? (
                <FlowCanvas
                  viewKey={layout.key}
                  nodes={nodes}
                  edges={edges}
                  focus={focus}
                  onNodeClick={onNodeClick}
                  onBackgroundClick={() => setSelectedId(undefined)}
                />
              ) : (
                <p className="muted center">Laying out…</p>
              )}
              <Legend withRun={run !== undefined} />
            </div>
          </>
        ) : (
          <Empty onExample={() => open(exampleFiles())} dragging={dragging} />
        )}
        {dragging && <div className="drop-overlay">Drop a folder or files to open</div>}
      </main>

      {flow && (
        <aside className="panel">
          {selectedNode ? (
            <DetailPanel flow={flow} node={selectedNode} run={run} repoUrl={repoUrl || undefined} onClose={() => setSelectedId(undefined)} />
          ) : (
            <div className="panel-content">
              <h2>{flow.flow}</h2>
              {flow.description && <p>{flow.description}</p>}
              <p className="muted">
                Click a step to expand it and see its details. {flow.nodes.length} steps, {flow.edges.length} transitions. Correlated by{" "}
                <code>{flow.correlationKey}</code>.
              </p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * Which sides of two nodes an edge connects. Normally bottom to top; when the
 * target is not below the source (same layer, or a link back up) the sides
 * facing each other are used instead, so the line does not cut through nodes.
 */
function handlesFor(
  source: string,
  target: string,
  selfLoop: boolean,
  positions: Map<string, Position> | undefined,
  heights: Map<string, number>,
): [string, string] {
  if (selfLoop) return ["loop-out", "loop-in"];
  const from = positions?.get(source);
  const to = positions?.get(target);
  if (from === undefined || to === undefined) return ["out", "in"];
  const below = to.y >= from.y + (heights.get(source) ?? 0) - 1;
  if (below) return ["out", "in"];
  return to.x >= from.x ? ["r-out", "l-in"] : ["l-out", "r-in"];
}

function Legend({ withRun }: { withRun: boolean }) {
  if (!withRun) return null;
  return (
    <ul className="legend" aria-label="Legend">
      <li><i className="status-dot status-success" /> success</li>
      <li><i className="status-dot status-failure" /> failed</li>
      <li><i className="status-dot status-pending" /> pending</li>
      <li><i className="status-dot status-not_reached" /> not reached</li>
      <li><i className="swatch taken" /> taken</li>
      <li><i className="swatch unexpected" /> unexpected</li>
    </ul>
  );
}

function Empty({ onExample, dragging }: { onExample: () => void; dragging: boolean }) {
  return (
    <div className={`empty ${dragging ? "over" : ""}`}>
      <h2>Open your flows</h2>
      <p>
        Drop a folder with flow files here, pick one in the sidebar, or point at a public GitHub repository. Everything runs in your browser;
        nothing is uploaded.
      </p>
      <button type="button" className="primary" onClick={onExample}>
        Open the order example
      </button>
    </div>
  );
}
