import { parseSource } from "./parse.js";
import { validateRunSemantics } from "./run-semantic.js";
import { validateRunStructure } from "./structure.js";
import type { Flow, Issue, Run, RunValidationResult } from "./types.js";

/**
 * Validates the text of one run document (JSON, or YAML) in two layers: the
 * JSON Schema first, then coherence rules. Pass the flow the run was matched
 * against to also check it names real nodes and edges.
 */
export function validateRunSource(text: string, file: string, options: { flow?: Flow } = {}): RunValidationResult {
  const parsed = parseSource(text, "a run document");
  let issues: Issue[] = parsed.issues;

  if (issues.length === 0) {
    issues = validateRunStructure(parsed.data, parsed.locate);
    if (issues.length === 0) {
      issues = validateRunSemantics(parsed.data as Run, parsed.locate, options.flow);
    }
  }

  issues = [...issues].sort((a, b) => a.line - b.line || a.column - b.column);
  const ok = issues.every((issue) => issue.severity !== "error");
  return ok ? { file, ok, issues, run: parsed.data as Run } : { file, ok, issues };
}
