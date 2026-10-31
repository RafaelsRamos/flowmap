import { validateFlowSource, validateRunSource, type Flow, type Issue, type Run } from "@flowmap/core";

/** One file read from a dropped folder, a file picker or a repository. */
export interface SourceFile {
  /** Path relative to the folder or repo root, with forward slashes. */
  path: string;
  text: string;
}

export interface LoadedFlow {
  path: string;
  flow: Flow;
  /** Warnings only: a flow with errors is listed under `problems` instead. */
  issues: Issue[];
}

export interface LoadedRun {
  path: string;
  run: Run;
  issues: Issue[];
}

export interface FileProblem {
  path: string;
  kind: "flow" | "run";
  issues: Issue[];
}

export interface Workspace {
  flows: LoadedFlow[];
  runs: LoadedRun[];
  problems: FileProblem[];
  /** Candidate files that are not Flowmap documents (no `schemaVersion`) and were ignored. */
  ignored: number;
}

export const EMPTY_WORKSPACE: Workspace = { flows: [], runs: [], problems: [], ignored: 0 };

const CANDIDATE = /\.(ya?ml|json)$/i;
const RUN_FILE = /\.run\.(json|ya?ml)$/i;
const OTHER_DOCUMENT = /\.analysis\.(json|ya?ml)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/**
 * Sorts loose files into flows and runs and validates them with the same code
 * as `flowmap validate`. YAML and JSON files without a `schemaVersion` are
 * ignored quietly, so a whole repository can be dropped without the build
 * config in it showing up as errors. Runs are checked against their flow.
 */
export function buildWorkspace(files: SourceFile[]): Workspace {
  const flows: LoadedFlow[] = [];
  const problems: FileProblem[] = [];
  const runFiles: SourceFile[] = [];
  let ignored = 0;

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    const segments = file.path.split("/");
    if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment))) continue;
    if (!CANDIDATE.test(file.path) || OTHER_DOCUMENT.test(file.path)) continue;
    if (!file.text.includes("schemaVersion")) {
      ignored += 1;
      continue;
    }
    if (RUN_FILE.test(file.path)) {
      runFiles.push(file);
      continue;
    }
    const result = validateFlowSource(file.text, file.path);
    if (result.ok && result.flow) {
      const same = flows.find((loaded) => loaded.flow.flow === result.flow?.flow);
      if (same !== undefined) {
        const duplicate: Issue = {
          severity: "warning",
          code: "duplicate-flow-name",
          message: `flow "${result.flow.flow}" is also defined in ${same.path}; runs are matched to that one`,
          path: "flow",
          line: 1,
          column: 1,
        };
        problems.push({ path: file.path, kind: "flow", issues: [duplicate] });
      }
      flows.push({ path: file.path, flow: result.flow, issues: result.issues });
    } else problems.push({ path: file.path, kind: "flow", issues: result.issues });
  }

  const runs: LoadedRun[] = [];
  for (const file of runFiles) {
    const first = validateRunSource(file.text, file.path);
    if (!first.ok || !first.run) {
      problems.push({ path: file.path, kind: "run", issues: first.issues });
      continue;
    }
    const flow = flows.find((candidate) => candidate.flow.flow === first.run?.flow)?.flow;
    if (flow === undefined) {
      problems.push({
        path: file.path,
        kind: "run",
        issues: [
          {
            severity: "warning",
            code: "no-flow-for-run",
            message: `no loaded flow is named "${first.run.flow}", so this run cannot be shown`,
            path: "flow",
            line: 1,
            column: 1,
          },
        ],
      });
      continue;
    }
    const checked = validateRunSource(file.text, file.path, { flow });
    if (checked.ok && checked.run) runs.push({ path: file.path, run: checked.run, issues: checked.issues });
    else problems.push({ path: file.path, kind: "run", issues: checked.issues });
  }

  return { flows, runs, problems, ignored };
}

/** Runs that were matched against the given flow, newest first. */
export function runsForFlow(workspace: Workspace, flow: Flow): LoadedRun[] {
  return workspace.runs
    .filter((loaded) => loaded.run.flow === flow.flow)
    .sort((a, b) => b.run.generatedAt.localeCompare(a.run.generatedAt) || a.path.localeCompare(b.path));
}

/** A short title for a run, such as `orderId 4821`. */
export function runTitle(run: Run): string {
  return Object.entries(run.correlation)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
}
