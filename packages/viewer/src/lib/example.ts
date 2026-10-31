import type { SourceFile } from "./workspace.js";

// The shared fixture, bundled into the app so "Open the example" works offline.
const bundled = import.meta.glob("../../../../examples/order-fulfilment/flows/**/*.{yml,yaml,json}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MARKER = "/order-fulfilment/flows/";

/** The order-fulfilment example: the flow plus its sample runs. */
export function exampleFiles(): SourceFile[] {
  return Object.entries(bundled).map(([path, text]) => ({
    path: path.slice(path.indexOf(MARKER) + MARKER.length - "flows/".length),
    text,
  }));
}
