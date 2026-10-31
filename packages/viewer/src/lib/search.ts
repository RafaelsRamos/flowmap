import type { Flow, FlowNode } from "@flowmap/core";

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

/**
 * Finds nodes whose label, id, service, description, code anchor or log events
 * contain every word of the query (case-insensitive). Label matches come first.
 */
export function searchNodes(flow: Flow, query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const hits: Array<SearchHit & { rank: number; order: number }> = [];
  flow.nodes.forEach((node, order) => {
    const candidates = fields(node);
    const everyWordFound = words.every((word) => candidates.some(([, text]) => text.toLowerCase().includes(word)));
    if (!everyWordFound) return;
    const first = words[0] ?? "";
    const reason = candidates.find(([, text]) => text.toLowerCase().includes(first))?.[0] ?? "label";
    const rank = node.label.toLowerCase().includes(first) ? 0 : node.id.includes(first) ? 1 : 2;
    hits.push({ id: node.id, reason, rank, order });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ id, reason }) => ({ id, reason }));
}
