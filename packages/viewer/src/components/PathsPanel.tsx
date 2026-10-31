import type { Flow } from "@flowmap/core";
import { pathNodes } from "../lib/paths.js";

interface Props {
  flow: Flow;
  from: string | undefined;
  to: string | undefined;
  paths: number[][];
  truncated: boolean;
  /** Which of the paths the loaded run walked completely; undefined without a run. */
  walked: boolean[] | undefined;
  selected: number | undefined;
  onFrom: (id: string | undefined) => void;
  onTo: (id: string | undefined) => void;
  onSelect: (index: number | undefined) => void;
  onSwap: () => void;
}

export function PathsPanel({ flow, from, to, paths, truncated, walked, selected, onFrom, onTo, onSelect, onSwap }: Props) {
  const label = (id: string): string => flow.nodes.find((node) => node.id === id)?.label ?? id;
  const ready = from !== undefined && to !== undefined;

  return (
    <div className="panel-content" data-testid="paths-panel">
      <header className="panel-title">
        <div>
          <h2>Paths</h2>
          <span className="muted small">Pick two steps, or click them on the graph.</span>
        </div>
      </header>

      <div className="path-pickers">
        <label>
          From
          <select value={from ?? ""} onChange={(event) => onFrom(event.target.value || undefined)}>
            <option value="">Choose a step</option>
            {flow.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="icon-button" onClick={onSwap} aria-label="Swap from and to" disabled={!ready}>
          ⇅
        </button>
        <label>
          To
          <select value={to ?? ""} onChange={(event) => onTo(event.target.value || undefined)}>
            <option value="">Choose a step</option>
            {flow.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!ready && <p className="muted">Choose where to start and where to end.</p>}
      {ready && paths.length === 0 && (
        <p className="muted">
          {from === to ? "Choose two different steps." : `There is no way from ${label(from)} to ${label(to)}.`}
        </p>
      )}

      {paths.length > 0 && (
        <>
          <div className="paths-summary">
            <b>
              {paths.length}
              {truncated ? "+" : ""} path{paths.length === 1 ? "" : "s"}
            </b>
            {selected !== undefined && (
              <button type="button" className="link-button" onClick={() => onSelect(undefined)}>
                Show all
              </button>
            )}
          </div>
          <ol className="path-list">
            {paths.map((path, index) => {
              const nodes = pathNodes(flow.edges, path);
              return (
                <li key={path.join("-")}>
                  <button
                    type="button"
                    className={`path-item ${selected === index ? "active" : ""}`}
                    onClick={() => onSelect(selected === index ? undefined : index)}
                  >
                    <span className="path-steps">
                      {nodes.map((id, step) => (
                        <span key={`${id}-${step}`}>
                          {step > 0 && <span className="path-arrow"> → </span>}
                          {label(id)}
                        </span>
                      ))}
                    </span>
                    {walked && (
                      <span className={`chip ${walked[index] ? "status-success" : "status-not_reached"}`}>
                        {walked[index] ? "taken in this run" : "not taken"}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {truncated && <p className="muted small">Showing the first {paths.length} paths.</p>}
        </>
      )}
    </div>
  );
}
