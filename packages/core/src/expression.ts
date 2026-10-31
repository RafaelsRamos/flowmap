import type { LogEvent } from "./events.js";

/** What a `display` field can hold; the run schema allows exactly these. */
export type FieldValue = string | number | boolean | null;

/**
 * Reads a path from an event: `ts`, `event` or `attributes.<name>[.<name>...]`.
 * This is the whole path syntax; there is no indexing, no wildcard and no eval.
 */
export function readPath(event: LogEvent, path: string): unknown {
  const [root, ...rest] = path.split(".");
  if (root === "ts") return rest.length === 0 ? event.ts : undefined;
  if (root === "event") return rest.length === 0 ? event.event : undefined;
  if (root !== "attributes") return undefined;
  let value: unknown = event.attributes;
  for (const segment of rest) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = Object.hasOwn(value, segment) ? (value as Record<string, unknown>)[segment] : undefined;
  }
  return value;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function toField(value: unknown): FieldValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/**
 * Evaluates one `display` expression over a node's matched events, oldest
 * first. A bare path is shorthand for `last(path)`. `first`/`last` skip events
 * where the path is missing, so a field set on only some events still shows;
 * when no event has it the result is null. `count(name)` counts the node's
 * events with that name.
 */
export function evaluateExpression(expression: string, events: readonly LogEvent[]): FieldValue {
  const count = /^count\((.+)\)$/.exec(expression);
  if (count?.[1] !== undefined) {
    const name = count[1];
    return events.filter((event) => event.event === name).length;
  }
  const call = /^(first|last)\((.+)\)$/.exec(expression);
  const which = call?.[1] ?? "last";
  const path = call?.[2] ?? expression;
  const values = events.map((event) => readPath(event, path)).filter(present);
  return toField(which === "first" ? values[0] : values[values.length - 1]);
}

/** Evaluates every `display` entry of a node, keeping the flow file's order. */
export function evaluateDisplay(
  display: Record<string, string>,
  events: readonly LogEvent[],
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const [label, expression] of Object.entries(display)) {
    fields[label] = evaluateExpression(expression, events);
  }
  return fields;
}
