import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { LogEvent } from "@flowmap/core";
import { normaliseRecord } from "./normalise.js";
import type { AdapterResult, LogAdapter, LogQuery } from "./types.js";

/**
 * Parses newline-delimited JSON text into events. `name` is the file's name,
 * used in each event's `ref` (`file://<name>#L<line>`, 1-based). Blank lines are
 * ignored; a line that is not JSON or lacks a timestamp, source or event name is
 * skipped with a warning that names its line.
 */
export function parseNdjson(text: string, name: string): AdapterResult {
  const events: LogEvent[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const number = index + 1;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      warnings.push(`${name}:${number}: skipped, not valid JSON`);
      return;
    }
    const result = normaliseRecord(record, `file://${encodeURI(name)}#L${number}`);
    if ("event" in result) events.push(result.event);
    else warnings.push(`${name}:${number}: skipped, ${result.reason}`);
  });
  return { events, warnings };
}

/** Reads NDJSON exports from disk. Honours the query's sources and time window; the engine does the rest. */
export function ndjsonAdapter(paths: string[]): LogAdapter {
  return {
    name: "ndjson",
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
        const parsed = parseNdjson(text, basename(path));
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
