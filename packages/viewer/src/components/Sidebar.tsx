import { useRef, useState, type ReactNode } from "react";
import { runTitle, runsForFlow, type FileProblem, type LoadedFlow, type Workspace } from "../lib/workspace.js";
import { clockTime } from "../lib/overlay.js";

interface Props {
  workspace: Workspace;
  flowPath: string | undefined;
  runPath: string | undefined;
  repoUrl: string;
  busy: boolean;
  error: string | undefined;
  onFiles: (files: FileList) => void;
  onExample: () => void;
  onRepo: (url: string) => void;
  onFlow: (path: string) => void;
  onRun: (path: string | undefined) => void;
  onRepoUrl: (url: string) => void;
}

export function Sidebar(props: Props) {
  const { workspace, flowPath, runPath } = props;
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [repoInput, setRepoInput] = useState("");

  const flow: LoadedFlow | undefined = workspace.flows.find((loaded) => loaded.path === flowPath);
  const runs = flow ? runsForFlow(workspace, flow.flow) : [];

  return (
    <aside className="sidebar">
      <h1 className="brand">Flowmap</h1>

      <Section title="Open">
        <div className="button-row">
          <button type="button" onClick={() => folderInput.current?.click()}>
            Folder…
          </button>
          <button type="button" onClick={() => filesInput.current?.click()}>
            Files…
          </button>
          <button type="button" onClick={props.onExample}>
            Example
          </button>
        </div>
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          // @ts-expect-error webkitdirectory is a non-standard attribute that React passes through.
          webkitdirectory=""
          onChange={(event) => event.target.files && props.onFiles(event.target.files)}
        />
        <input
          ref={filesInput}
          type="file"
          hidden
          multiple
          accept=".yml,.yaml,.json"
          onChange={(event) => event.target.files && props.onFiles(event.target.files)}
        />
        <form
          className="repo-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (repoInput.trim()) props.onRepo(repoInput);
          }}
        >
          <input
            type="text"
            placeholder="github.com/owner/repo"
            value={repoInput}
            onChange={(event) => setRepoInput(event.target.value)}
            aria-label="GitHub repository"
          />
          <button type="submit" disabled={props.busy || !repoInput.trim()}>
            Load
          </button>
        </form>
        {props.busy && <p className="muted small">Loading…</p>}
        {props.error && <p className="error small">{props.error}</p>}
        <p className="muted small">Or drop a folder or files anywhere on the page.</p>
      </Section>

      {workspace.flows.length > 0 && (
        <Section title="Flows">
          <ul className="list">
            {workspace.flows.map((loaded) => (
              <li key={loaded.path}>
                <button
                  type="button"
                  className={`list-item ${loaded.path === flowPath ? "active" : ""}`}
                  onClick={() => props.onFlow(loaded.path)}
                >
                  <span>{loaded.flow.flow}</span>
                  <span className="muted small">{loaded.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {flow && (
        <Section title="Run">
          <ul className="list">
            <li>
              <button type="button" className={`list-item ${runPath === undefined ? "active" : ""}`} onClick={() => props.onRun(undefined)}>
                <span>Design only</span>
                <span className="muted small">the flow as written, no instance</span>
              </button>
            </li>
            {runs.map((loaded) => (
              <li key={loaded.path}>
                <button
                  type="button"
                  className={`list-item ${loaded.path === runPath ? "active" : ""}`}
                  onClick={() => props.onRun(loaded.path)}
                >
                  <span>{runTitle(loaded.run)}</span>
                  <span className="muted small">
                    {loaded.run.generatedAt.slice(0, 10)} {clockTime(loaded.run.generatedAt)} · {summary(loaded.run)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {runs.length === 0 && <p className="muted small">No runs for this flow. Add a *.run.json file.</p>}
        </Section>
      )}

      <Section title="Code links">
        <input
          type="text"
          placeholder="https://github.com/owner/repo"
          value={props.repoUrl}
          onChange={(event) => props.onRepoUrl(event.target.value)}
          aria-label="Repository URL for code links"
        />
        <p className="muted small">Node code anchors link into this repository.</p>
      </Section>

      {workspace.problems.length > 0 && <Problems problems={workspace.problems} />}
      {workspace.ignored > 0 && (
        <p className="muted small">
          {workspace.ignored} other YAML/JSON file{workspace.ignored === 1 ? "" : "s"} ignored (no schemaVersion).
        </p>
      )}
    </aside>
  );
}

function summary(run: { nodes: Record<string, { status: string }>; unexpected: unknown[] }): string {
  const statuses = Object.values(run.nodes).map((node) => node.status);
  if (statuses.includes("failure")) return "failed";
  if (run.unexpected.length > 0) return "unexpected transition";
  if (statuses.includes("pending")) return "in progress";
  return "complete";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Problems({ problems }: { problems: FileProblem[] }) {
  const errors = problems.filter((problem) => problem.issues.some((issue) => issue.severity === "error")).length;
  return (
    <section className="sidebar-section" data-testid="problems">
      <h2>
        Problems <span className="chip status-failure">{problems.length}</span>
      </h2>
      <p className="muted small">
        {errors} file{errors === 1 ? "" : "s"} could not be shown. Same checks as <code>flowmap validate</code>.
      </p>
      {problems.map((problem) => (
        <details key={problem.path} className="problem">
          <summary>{problem.path}</summary>
          <ul>
            {problem.issues.map((issue, index) => (
              <li key={index} className={issue.severity}>
                <code>
                  {issue.line}:{issue.column}
                </code>{" "}
                {issue.message} <span className="muted">[{issue.code}]</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
