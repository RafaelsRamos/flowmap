/** Shape of a flow file once it has passed structural validation. */
export interface Flow {
  schemaVersion: 1;
  flow: string;
  description?: string;
  correlationKey: string;
  start: string;
  end: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowNode {
  id: string;
  label: string;
  description?: string;
  service?: string;
  code?: string;
  evidence?: Evidence;
}

export interface Evidence {
  source: string;
  match: { event: string[]; correlate: string };
  outcome?: { success?: string; failure?: string };
  display?: Record<string, string>;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  when?: string;
}

export type Severity = "error" | "warning";

/** One finding about a flow file, positioned in the source text. */
export interface Issue {
  severity: Severity;
  /** Stable machine-readable code, for example `unknown-node`. */
  code: string;
  message: string;
  /** Location in the document, for example `nodes[2].evidence.match`. */
  path: string;
  /** 1-based line and column in the source text. */
  line: number;
  column: number;
}

export interface ValidationResult {
  file: string;
  /** True when there are no errors (warnings do not count). */
  ok: boolean;
  issues: Issue[];
  /** The parsed flow, present only when `ok` is true. */
  flow?: Flow;
}

export type PathSegment = string | number;

/** A position in the source, resolved from a document path. */
export interface Position {
  line: number;
  column: number;
}

export type RunStatus = "success" | "failure" | "pending" | "not_reached";

/** Shape of a run document once it has passed structural validation. */
export interface Run {
  schemaVersion: 1;
  flow: string;
  flowRevision?: string;
  correlation: Record<string, string>;
  generatedAt: string;
  nodes: Record<string, RunNode>;
  edges: ObservedEdge[];
  unexpected: UnexpectedEdge[];
}

export interface RunNode {
  status: RunStatus;
  fields?: Record<string, string | number | boolean | null>;
  evidence?: EvidenceEntry[];
}

export interface EvidenceEntry {
  ts: string;
  event: string;
  msg?: string;
  ref?: string;
  /** The log line itself. */
  raw?: string;
}

export interface ObservedEdge {
  from: string;
  to: string;
  label?: string;
  observed: number;
}

export interface UnexpectedEdge {
  from: string;
  to: string;
  ts?: string;
  ref?: string;
  raw?: string;
}

export interface RunValidationResult {
  file: string;
  /** True when there are no errors (warnings do not count). */
  ok: boolean;
  issues: Issue[];
  /** The parsed run, present only when `ok` is true. */
  run?: Run;
}
