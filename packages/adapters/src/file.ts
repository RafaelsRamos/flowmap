import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { LogEvent } from "@flowmap/core";
import { parseNdjson } from "./ndjson.js";
import { parseLogText, type TextFormat } from "./text.js";
import type { AdapterResult, LogAdapter, LogQuery } from "./types.js";

export interface FileAdapterOptions {
  format?: TextFormat;
  /** Source for lines that name none; defaults to the file's name without its extension. */
  source?: string;
}

const STRICT_JSON_LINES = new Set([".ndjson", ".jsonl"]);

/**
 * Reads log files from disk: `.ndjson`/`.jsonl` as strict newline-delimited JSON
 * (every bad line is reported), anything else (`.log`, `.txt`, no extension) with
 * the plain-text readers. Honours the query's sources and time window; the
 * engine does the rest.
 */
export function fileAdapter(paths: string[], options: FileAdapterOptions = {}): LogAdapter {
  return {
    name: paths.every((p) => STRICT_JSON_LINES.has(extname(p).toLowerCase())) ? "ndjson" : "file",
    async fetch(query: LogQuery): Promise<AdapterResult> {
      const events: LogEvent[] = [];
      const warnings: string[] = [];
      for (const path of paths) {
        let text: string;
        try {
          text = await readFile(path, "utf8");
        } catch {
          throw new Error(`cannot read "${path}": no such file or directory`);
        }
        const name = basename(path);
        const extension = extname(name);
        const parsed = STRICT_JSON_LINES.has(extension.toLowerCase())
          ? parseNdjson(text, name)
          : parseLogText(text, name, {
              ...(options.format === undefined ? {} : { format: options.format }),
              defaultSource: options.source ?? (extension === "" ? name : name.slice(0, -extension.length)),
            });
        events.push(...parsed.events);
        warnings.push(...parsed.warnings);
      }
      return { events: events.filter((event) => inQuery(event, query)), warnings };
    },
  };
}

function inQuery(event: LogEvent, query: LogQuery): boolean {
  if (query.sources.length > 0 && !query.sources.includes(event.source)) return false;
  const time = Date.parse(event.ts);
  if (query.from !== undefined && time < query.from.getTime()) return false;
  if (query.to !== undefined && time > query.to.getTime()) return false;
  return true;
}
