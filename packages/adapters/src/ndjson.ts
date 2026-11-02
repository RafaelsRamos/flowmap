import type { LogEvent } from "@flowmap/core";
import { normaliseRecord } from "./normalise.js";
import type { AdapterResult } from "./types.js";

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
    const result = normaliseRecord(record, `file://${encodeURI(name)}#L${number}`, { raw: line });
    if ("event" in result) events.push(result.event);
    else warnings.push(`${name}:${number}: skipped, ${result.reason}`);
  });
  return { events, warnings };
}
