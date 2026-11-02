import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateFlowSource } from "@flowmap/core";
import { parse } from "yaml";

const skill = join(import.meta.dirname, "../../../skills/flowmap-build-flows");
const read = (file: string): string => readFileSync(join(skill, file), "utf8");

describe("skill: flowmap-build-flows", () => {
  it("has the frontmatter an agent needs to find and load it", () => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(read("SKILL.md"));
    expect(match).not.toBeNull();
    const meta = parse(match?.[1] ?? "") as { name?: string; description?: string };
    expect(meta.name).toBe("flowmap-build-flows");
    expect(meta.description?.length).toBeGreaterThan(80);
    expect(meta.description).toContain("flow");
  });

  it("ships a template that passes the validator without warnings", () => {
    const result = validateFlowSource(read("flow-template.yml"), "flow-template.yml");
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("points at files that exist and documents every validator rule", () => {
    const text = read("SKILL.md");
    for (const file of ["reference.md", "flow-template.yml"]) {
      expect(text).toContain(file);
      expect(() => read(file)).not.toThrow();
    }
    const docs = readFileSync(join(import.meta.dirname, "../../../docs/flow-format.md"), "utf8");
    const codes = [...docs.matchAll(/^\| `([a-z-]+)` \| (?:error|warning) \|/gm)].map((m) => m[1] as string);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect(read("reference.md"), code).toContain(`\`${code}\``);
  });

  it("keeps the AGENTS.md snippet in sync with docs/agents-snippet.md", () => {
    const snippet = readFileSync(join(import.meta.dirname, "../../../docs/agents-snippet.md"), "utf8");
    const block = /```markdown\n([\s\S]*?)```/.exec(snippet)?.[1];
    expect(block).toBeDefined();
    expect(read("SKILL.md")).toContain((block ?? "").trim());
  });
});
