import { describe, expect, it } from "vitest";
import { findPaths, pathNodes } from "../src/lib/paths.js";

const edges = [
  { from: "a", to: "b" }, // 0
  { from: "a", to: "c" }, // 1
  { from: "b", to: "d" }, // 2
  { from: "c", to: "d" }, // 3
  { from: "b", to: "b" }, // 4: self-loop
  { from: "d", to: "a" }, // 5: back edge
  { from: "d", to: "e" }, // 6
];

describe("findPaths", () => {
  it("finds every path between two nodes", () => {
    expect(findPaths(edges, "a", "e").paths).toEqual([
      [0, 2, 6],
      [1, 3, 6],
    ]);
  });

  it("ignores self-loops and never revisits a node", () => {
    const { paths } = findPaths(edges, "a", "d");
    expect(paths).toEqual([
      [0, 2],
      [1, 3],
    ]);
    // The back edge d -> a would make a cycle, so it never appears.
    expect(paths.flat()).not.toContain(5);
    expect(paths.flat()).not.toContain(4);
  });

  it("finds paths in the middle of the graph, and none the wrong way round", () => {
    expect(findPaths(edges, "b", "e").paths).toEqual([[2, 6]]);
    expect(findPaths(edges, "e", "a").paths).toEqual([]);
  });

  it("returns nothing for the same start and end", () => {
    expect(findPaths(edges, "a", "a")).toEqual({ paths: [], truncated: false });
  });

  it("keeps parallel edges as separate paths", () => {
    const parallel = [
      { from: "a", to: "b" },
      { from: "a", to: "b" },
    ];
    expect(findPaths(parallel, "a", "b").paths).toEqual([[0], [1]]);
  });

  it("stops at the limit and says so", () => {
    // Ten diamonds in a row have 2^10 paths.
    const chain: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < 10; i += 1) {
      chain.push({ from: `n${i}`, to: `l${i}` }, { from: `n${i}`, to: `r${i}` });
      chain.push({ from: `l${i}`, to: `n${i + 1}` }, { from: `r${i}`, to: `n${i + 1}` });
    }
    const result = findPaths(chain, "n0", "n10", 50);
    expect(result.paths).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(findPaths(chain, "n0", "n10", 1024).truncated).toBe(false);
  });

  it("lists the nodes a path goes through", () => {
    expect(pathNodes(edges, [0, 2, 6])).toEqual(["a", "b", "d", "e"]);
    expect(pathNodes(edges, [])).toEqual([]);
  });
});
