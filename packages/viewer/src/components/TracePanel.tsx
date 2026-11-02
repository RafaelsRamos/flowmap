import { useRef, useState } from "react";
import type { Flow, Run } from "@flowmap/core";
import { traceFromLogs, type LogInput, type TraceOutcome } from "../lib/trace.js";

interface Props {
  flow: Flow;
  onTraced: (run: Run) => void;
}

/**
 * Builds a run from logs the user supplies by hand (files or pasted text), in
 * the browser, with the same engine as `flowmap trace`. Nothing is uploaded.
 */
export function TracePanel({ flow, onTraced }: Props) {
  const filePicker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<LogInput[]>([]);
  const [pasted, setPasted] = useState("");
  const [format, setFormat] = useState("");
  const [value, setValue] = useState("");
  const [outcome, setOutcome] = useState<TraceOutcome>();

  const addFiles = async (list: FileList): Promise<void> => {
    const read = await Promise.all(Array.from(list).map(async (file) => ({ name: file.name, text: await file.text() })));
    setFiles((current) => [...current.filter((existing) => !read.some((added) => added.name === existing.name)), ...read]);
  };

  const trace = (): void => {
    const logs: LogInput[] = [...files, ...(pasted.trim() === "" ? [] : [{ name: "pasted.log", text: pasted, pasted: true }])];
    const result = traceFromLogs({ flow, correlationValue: value, logs, format, now: new Date() });
    setOutcome(result);
    if (result.ok) onTraced(result.run);
  };

  const download = (run: Run): void => {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(run, null, 2)}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${flow.flow}-${Object.values(run.correlation)[0] ?? "run"}.run.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="trace-panel" data-testid="trace-panel">
      <p className="muted small">
        Have logs but no backend? Add a <code>.log</code>, <code>.txt</code> or <code>.ndjson</code> file, or paste lines. They are read in
        this page and never uploaded.
      </p>
      <div className="button-row">
        <button type="button" onClick={() => filePicker.current?.click()}>
          Log files…
        </button>
      </div>
      <input ref={filePicker} type="file" hidden multiple onChange={(event) => event.target.files && void addFiles(event.target.files)} />
      {files.length > 0 && (
        <ul className="list">
          {files.map((file) => (
            <li key={file.name} className="file-chip">
              <span>{file.name}</span>
              <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((f) => f !== file))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        rows={5}
        placeholder={'Or paste log lines, e.g.\n2026-10-31T09:03:00Z source=payments-api event=payment.declined order_id=4821'}
        value={pasted}
        onChange={(event) => setPasted(event.target.value)}
        aria-label="Pasted log lines"
        spellCheck={false}
      />
      <details>
        <summary>Custom format (JSON or YAML)</summary>
        <p className="muted small">
          For plain text the page cannot read on its own: a <code>pattern</code> with named groups, <code>events</code> rules, a{" "}
          <code>source</code> and a <code>timezone</code>.
        </p>
        <textarea rows={6} value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Log format" spellCheck={false} />
      </details>
      <form
        className="repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          trace();
        }}
      >
        <input type="text" placeholder={flow.correlationKey} value={value} onChange={(event) => setValue(event.target.value)} aria-label={flow.correlationKey} />
        <button type="submit">Trace</button>
      </form>
      {outcome && !outcome.ok && <p className="error small">{outcome.error}</p>}
      {outcome?.ok && (
        <p className="small">
          Traced {Object.entries(outcome.run.correlation).map(([key, id]) => `${key} ${id}`).join(", ")}: {outcome.summary.eventsMatched} of{" "}
          {outcome.summary.eventsRead} events matched, {outcome.summary.unexpected} unexpected.{" "}
          <button type="button" className="link-button" onClick={() => download(outcome.run)}>
            Download run.json
          </button>
        </p>
      )}
      {outcome?.warnings.map((warning) => (
        <p key={warning} className="muted small">
          {warning}
        </p>
      ))}
    </div>
  );
}
