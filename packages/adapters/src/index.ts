// Everything here runs in a browser as well as in Node; file access is in "@flowmap/adapters/node".
export { buildQuery, type AdapterResult, type LogAdapter, type LogQuery } from "./types.js";
export { normaliseRecord, type Defaults, type Normalised } from "./normalise.js";
export { parseNdjson } from "./ndjson.js";
export { parseLogText, readLogFormat, type TextFormat, type TextOptions } from "./text.js";
export { buildLogql, lokiAdapter, type LokiOptions } from "./loki.js";
