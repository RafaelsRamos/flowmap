import _Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import { flowSchema } from "@flowmap/schema";
import type { Issue, PathSegment } from "./types.js";
import type { Locate } from "./parse.js";

// ajv ships CommonJS; under NodeNext the constructor sits on `.default`.
const Ajv2020 = _Ajv2020 as unknown as typeof _Ajv2020.default;

const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
// Custom annotations used by flow.schema.json for friendlier messages.
ajv.addVocabulary(["x-message", "x-reservedProperties"]);
const validateSchema = ajv.compile(flowSchema);

/** Renders a document path the way people write it: `nodes[2].evidence.match`. */
export function formatPath(path: readonly PathSegment[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Checks parsed data against the flow schema. Returns no issues when the data
 * is a structurally valid flow; the semantic layer relies on that.
 */
export function validateStructure(data: unknown, locate: Locate): Issue[] {
  if (validateSchema(data)) return [];
  const issues = (validateSchema.errors ?? []).map((error) => toIssue(error, data, locate));
  return dedupe(issues);
}

function toIssue(error: ErrorObject, data: unknown, locate: Locate): Issue {
  const instancePath = toSegments(error.instancePath, data);

  switch (error.keyword) {
    case "required": {
      const property = String((error.params as { missingProperty: string }).missingProperty);
      const where = locate(instancePath);
      return {
        severity: "error",
        code: "missing-property",
        message: `${subject(instancePath)} is missing required property "${property}"`,
        path: formatPath([...instancePath, property]),
        line: where.line,
        column: where.column,
      };
    }
    case "additionalProperties": {
      const property = String((error.params as { additionalProperty: string }).additionalProperty);
      const path = [...instancePath, property];
      const where = locate(path, { key: true });
      const schema = (error.parentSchema ?? {}) as {
        properties?: Record<string, unknown>;
        "x-reservedProperties"?: string[];
      };
      if (schema["x-reservedProperties"]?.includes(property)) {
        return {
          severity: "error",
          code: "reserved-property",
          message: `"${property}" is reserved for a future version of the schema and is not supported yet`,
          path: formatPath(path),
          line: where.line,
          column: where.column,
        };
      }
      const suggestion = closest(property, Object.keys(schema.properties ?? {}));
      return {
        severity: "error",
        code: "unknown-property",
        message:
          `unknown property "${property}" in ${subject(instancePath)}` +
          (suggestion ? ` (did you mean "${suggestion}"?)` : ""),
        path: formatPath(path),
        line: where.line,
        column: where.column,
      };
    }
    default: {
      const where = locate(instancePath);
      const custom = (error.parentSchema as { "x-message"?: string } | undefined)?.["x-message"];
      const code = error.keyword === "type" ? "wrong-type" : "invalid-value";
      return {
        severity: "error",
        code,
        message: `${subject(instancePath)} ${custom ?? plain(error)}`,
        path: formatPath(instancePath),
        line: where.line,
        column: where.column,
      };
    }
  }
}

function subject(path: readonly PathSegment[]): string {
  return path.length === 0 ? "the document" : formatPath(path);
}

/** Rewrites ajv's wording ("must NOT have fewer than 1 items") into plainer text. */
function plain(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "type":
      return `must be ${article(String(params.type))}`;
    case "minItems":
      return `must have at least ${String(params.limit)} item${params.limit === 1 ? "" : "s"}`;
    case "minProperties":
      return `must have at least ${String(params.limit)} propert${params.limit === 1 ? "y" : "ies"}`;
    case "minLength":
      return `must not be empty`;
    case "uniqueItems":
      return `must not contain duplicates (items ${String(params.j)} and ${String(params.i)} are the same)`;
    default:
      return error.message ?? "is invalid";
  }
}

function article(type: string): string {
  return type === "object" || type === "array" || type === "integer" ? `an ${type}` : `a ${type}`;
}

/** Converts an ajv JSON pointer into path segments, using the data to tell indices from keys. */
function toSegments(instancePath: string, data: unknown): PathSegment[] {
  if (instancePath === "") return [];
  const segments: PathSegment[] = [];
  let current: unknown = data;
  for (const raw of instancePath.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      segments.push(Number(key));
      current = current[Number(key)];
    } else {
      segments.push(key);
      current = (current as Record<string, unknown> | undefined)?.[key];
    }
  }
  return segments;
}

/** ajv can report the same problem through several schema branches; keep one. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Nearest candidate within two edits, for "did you mean" hints. */
function closest(word: string, candidates: string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const name of candidates) {
    const distance = editDistance(word, name);
    if (distance <= 2 && (best === undefined || distance < best.distance)) best = { name, distance };
  }
  return best?.name;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
