import type { Flow, FlowNode, Run } from "@flowmap/core";

export interface SearchHit {
  id: string;
  /** What matched, for display: `label`, `service`, `event payment.declined`... */
  reason: string;
}

/** Text a node can be found by, with the name shown for each kind. */
function fields(node: FlowNode): Array<[string, string]> {
  const list: Array<[string, string]> = [
    ["label", node.label],
    ["id", node.id],
    ["service", node.service ?? ""],
    ["description", node.description ?? ""],
    ["code", node.code ?? ""],
    ["source", node.evidence?.source ?? ""],
  ];
  for (const event of node.evidence?.match.event ?? []) list.push([`event ${event}`, event]);
  return list.filter(([, text]) => text !== "");
}

const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 40;

/** The log lines of a node in the run, as text to search: the raw line, else message and event, plus extracted fields. */
function logTexts(run: Run | undefined, node: FlowNode): string[] {
  const runNode = run?.nodes[node.id];
  if (runNode === undefined) return [];
  const texts = (runNode.evidence ?? []).map((entry) => entry.raw ?? [entry.msg, entry.event, entry.ref].filter(Boolean).join(" "));
  for (const [name, value] of Object.entries(runNode.fields ?? {})) texts.push(`${name} ${String(value)}`);
  return texts;
}

/** A short excerpt of a log line around the first place `word` occurs, for the search result. */
function snippet(text: string, word: string): string {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(word);
  if (at === -1) return flat.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(flat.length, at + word.length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/**
 * Finds nodes whose label, id, service, description, code anchor or log events
 * contain every word of the query (case-insensitive). With a run, the log lines
 * the run recorded for each node are searched too, so a message, an id or any
 * attribute found in a log highlights the step it belongs to. Label matches
 * come first, log matches last.
 */
export function searchNodes(flow: Flow, query: string, run?: Run): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const hits: Array<SearchHit & { rank: number; order: number }> = [];
  flow.nodes.forEach((node, order) => {
    const candidates: Array<[string, string]> = [...fields(node), ...logTexts(run, node).map((text): [string, string] => ["log", text])];
    const everyWordFound = words.every((word) => candidates.some(([, text]) => text.toLowerCase().includes(word)));
    if (!everyWordFound) return;
    const first = words[0] ?? "";
    const found = candidates.find(([, text]) => text.toLowerCase().includes(first));
    const reason = found === undefined ? "label" : found[0] === "log" ? `log: ${snippet(found[1], first)}` : found[0];
    const rank = node.label.toLowerCase().includes(first) ? 0 : node.id.includes(first) ? 1 : found?.[0] === "log" ? 3 : 2;
    hits.push({ id: node.id, reason, rank, order });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ id, reason }) => ({ id, reason }));
}
