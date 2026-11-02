import type { Flow, FlowNode, Run } from "@flowmap/core";
import { codeUrl, parseCodeAnchor, revisionRef } from "../lib/code-link.js";
import { clockTime } from "../lib/overlay.js";

const STATUS_LABEL = { success: "Success", failure: "Failed", pending: "Pending", not_reached: "Not reached" } as const;

interface Props {
  flow: Flow;
  node: FlowNode;
  run: Run | undefined;
  repoUrl: string | undefined;
  onClose: () => void;
}

export function DetailPanel({ flow, node, run, repoUrl, onClose }: Props) {
  const runNode = run?.nodes[node.id];
  const evidence = node.evidence;
  const link = node.code ? codeUrl(repoUrl, node.code, revisionRef(run?.flowRevision)) : undefined;
  const anchor = node.code ? parseCodeAnchor(node.code) : undefined;
  const unexpectedArrivals = (run?.unexpected ?? []).filter((edge) => edge.to === node.id);

  return (
    <div className="panel-content" data-testid="detail-panel">
      <header className="panel-title">
        <div>
          <h2>{node.label}</h2>
          <code className="muted">{node.id}</code>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <div className="chips">
        {flow.start === node.id && <span className="chip">start</span>}
        {flow.end.includes(node.id) && <span className="chip">end</span>}
        {runNode && <span className={`chip status-${runNode.status}`}>{STATUS_LABEL[runNode.status]}</span>}
      </div>

      {node.description && <p>{node.description}</p>}

      <dl className="props">
        {node.service && (
          <>
            <dt>Service</dt>
            <dd>{node.service}</dd>
          </>
        )}
        {anchor && (
          <>
            <dt>Code</dt>
            <dd>
              {link ? (
                <a href={link} target="_blank" rel="noreferrer">
                  {anchor.path}
                </a>
              ) : (
                <span>{anchor.path}</span>
              )}
              {anchor.symbol && <span className="muted"> · {anchor.symbol}</span>}
              {!link && <div className="muted small">Set a repository URL in the sidebar to link this.</div>}
            </dd>
          </>
        )}
      </dl>

      <section>
        <h3>Log events</h3>
        {evidence ? (
          <>
            <p className="muted small">
              Source <b>{evidence.source}</b>, correlated by <code>{evidence.match.correlate}</code>
            </p>
            <ul className="events">
              {evidence.match.event.map((event) => (
                <li key={event}>
                  <code>{event}</code>
                  {evidence.outcome?.success === event && <span className="chip status-success">success</span>}
                  {evidence.outcome?.failure === event && <span className="chip status-failure">failure</span>}
                </li>
              ))}
            </ul>
            {evidence.display && (
              <>
                <h4>Shown in the expanded node</h4>
                <dl className="props">
                  {Object.entries(evidence.display).map(([name, expression]) => (
                    <div key={name} className="prop-row">
                      <dt>{name}</dt>
                      <dd>
                        <code>{expression}</code>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </>
        ) : (
          <p className="muted">No evidence rules: this step is drawn but cannot be confirmed from logs.</p>
        )}
      </section>

      {run && (
        <section>
          <h3>In this run</h3>
          {runNode?.fields && Object.keys(runNode.fields).length > 0 && (
            <dl className="props">
              {Object.entries(runNode.fields).map(([name, value]) => (
                <div key={name} className="prop-row">
                  <dt>{name}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {unexpectedArrivals.map((arrival, index) => (
            <div key={index} className="unexpected-note" data-testid="unexpected-arrival">
              <b>Unexpected:</b> reached from <code>{arrival.from}</code>, which the flow does not allow
              {arrival.ts && <time title={arrival.ts}> at {clockTime(arrival.ts)}</time>}.
              {arrival.raw !== undefined ? <pre className="raw">{arrival.raw}</pre> : arrival.ref && <code className="muted small ref">{arrival.ref}</code>}
            </div>
          ))}
          {runNode?.evidence && runNode.evidence.length > 0 ? (
            <ol className="evidence">
              {runNode.evidence.map((entry, index) => (
                <li key={`${entry.ts}-${index}`}>
                  <time title={entry.ts}>{clockTime(entry.ts)}</time>
                  <div>
                    <div>{entry.msg ?? entry.event}</div>
                    <code className="muted small">{entry.event}</code>
                    {entry.raw !== undefined ? (
                      <pre className="raw" title={entry.ref}>{entry.raw}</pre>
                    ) : (
                      entry.ref && <code className="muted small ref">{entry.ref}</code>
                    )}
                    {entry.raw !== undefined && entry.ref && <code className="muted small ref">{entry.ref}</code>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No evidence recorded for this step in the run.</p>
          )}
        </section>
      )}
    </div>
  );
}
