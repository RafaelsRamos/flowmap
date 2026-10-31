import { parseSource } from "./parse.js";
import { validateSemantics } from "./semantic.js";
import { validateStructure } from "./structure.js";
import type { Flow, Issue, ValidationResult } from "./types.js";

/**
 * Validates the text of one flow file (YAML or JSON) in two layers: the JSON
 * Schema first, then graph rules. The graph layer only runs on a structurally
 * valid file, so its messages never describe a half-broken document.
 */
export function validateFlowSource(text: string, file: string): ValidationResult {
  const parsed = parseSource(text);
  let issues: Issue[] = parsed.issues;

  if (issues.length === 0) {
    issues = validateStructure(parsed.data, parsed.locate);
    if (issues.length === 0) {
      issues = validateSemantics(parsed.data as Flow, parsed.locate);
    }
  }

  issues = [...issues].sort((a, b) => a.line - b.line || a.column - b.column);
  const ok = issues.every((issue) => issue.severity !== "error");
  return ok ? { file, ok, issues, flow: parsed.data as Flow } : { file, ok, issues };
}
