import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import type { Issue, PathSegment, Position } from "./types.js";

/**
 * Maps a document path to a position in the source text. With `key: true` the
 * position is that of the property name rather than its value. A path that
 * does not exist resolves to its nearest existing ancestor.
 */
export type Locate = (path: readonly PathSegment[], options?: { key?: boolean }) => Position;

export interface ParsedSource {
  /** The document as plain data, or undefined when the text could not be parsed. */
  data: unknown;
  locate: Locate;
  /** Syntax problems; when non-empty, `data` is undefined. */
  issues: Issue[];
}

/**
 * Parses YAML or JSON text into the same plain data model. JSON is parsed as
 * YAML (a near-superset), so both formats report positions the same way.
 */
export function parseSource(text: string): ParsedSource {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  const locate = makeLocator(doc, lineCounter);

  if (doc.errors.length > 0) {
    const issues = doc.errors.map((error): Issue => {
      const pos = error.linePos?.[0] ?? { line: 1, col: 1 };
      return {
        severity: "error",
        code: "syntax",
        message: syntaxMessage(error.message),
        path: "",
        line: pos.line,
        column: pos.col,
      };
    });
    return { data: undefined, locate, issues };
  }

  if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)) {
    const position = { line: 1, col: 1 };
    return {
      data: undefined,
      locate,
      issues: [
        {
          severity: "error",
          code: "empty-file",
          message: "file is empty; expected a flow definition",
          path: "",
          line: position.line,
          column: position.col,
        },
      ],
    };
  }

  return { data: doc.toJS(), locate, issues: [] };
}

/** yaml appends a source excerpt after the first line; the CLI prints its own position. */
function syntaxMessage(message: string): string {
  const firstLine = message.split("\n")[0] ?? message;
  return firstLine.replace(/ at line \d+, column \d+:?$/, "").trim();
}

function makeLocator(doc: Document.Parsed, lineCounter: LineCounter): Locate {
  return (path, options) => {
    let node: unknown = doc.contents;
    let keyNode: unknown;
    let consumed = 0;

    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find(
          (item) => isScalar(item.key) && String(item.key.value) === String(segment),
        );
        if (!pair) break;
        keyNode = pair.key;
        node = pair.value;
      } else if (isSeq(node) && typeof segment === "number") {
        const item = node.items[segment];
        if (item === undefined) break;
        keyNode = undefined;
        node = item;
      } else {
        break;
      }
      consumed += 1;
    }

    const wantsKey = options?.key === true && consumed === path.length && keyNode !== undefined;
    const target = wantsKey ? keyNode : node;
    const offset = rangeStart(target) ?? 0;
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };
}

function rangeStart(node: unknown): number | undefined {
  if (typeof node === "object" && node !== null && "range" in node) {
    const range = (node as { range?: [number, number, number] | null }).range;
    return range?.[0];
  }
  return undefined;
}
