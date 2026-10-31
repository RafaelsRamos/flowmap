import { describe, expect, it } from "vitest";
import { fetchRepoFiles, parseRepoSpec, repoWebUrl } from "../src/lib/github.js";

describe("parseRepoSpec", () => {
  it("reads owner/repo in its usual forms", () => {
    expect(parseRepoSpec("acme/shop")).toEqual({ owner: "acme", repo: "shop" });
    expect(parseRepoSpec("https://github.com/acme/shop")).toEqual({ owner: "acme", repo: "shop" });
    expect(parseRepoSpec("https://github.com/acme/shop.git")).toEqual({ owner: "acme", repo: "shop" });
    expect(parseRepoSpec("  https://github.com/acme/shop/  ")).toEqual({ owner: "acme", repo: "shop" });
  });

  it("reads a branch and folder from a tree URL", () => {
    expect(parseRepoSpec("https://github.com/acme/shop/tree/main/services/orders/flows")).toEqual({
      owner: "acme",
      repo: "shop",
      ref: "main",
      directory: "services/orders/flows",
    });
  });

  it("rejects anything else", () => {
    expect(parseRepoSpec("https://gitlab.com/acme/shop")).toBeUndefined();
    expect(parseRepoSpec("shop")).toBeUndefined();
    expect(parseRepoSpec("")).toBeUndefined();
    expect(repoWebUrl({ owner: "acme", repo: "shop" })).toBe("https://github.com/acme/shop");
  });
});

/** A fake of the two GitHub endpoints the loader uses. */
function fakeGithub(tree: Array<{ path: string; type: string }>, files: Record<string, string>, requests: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === "https://api.github.com/repos/acme/shop") return json({ default_branch: "trunk" });
    if (url.startsWith("https://api.github.com/repos/acme/shop/git/trees/")) return json({ tree });
    const raw = /^https:\/\/raw\.githubusercontent\.com\/acme\/shop\/[^/]+\/(.+)$/.exec(url);
    if (raw?.[1] !== undefined && files[decodeURIComponent(raw[1])] !== undefined) return new Response(files[decodeURIComponent(raw[1])]);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("fetchRepoFiles", () => {
  const tree = [
    { path: "flows/orders.yml", type: "blob" },
    { path: "flows/examples/order-1.run.json", type: "blob" },
    { path: "services/pay/flows/pay.yaml", type: "blob" },
    { path: "package.json", type: "blob" },
    { path: "docker/compose.yml", type: "blob" },
    { path: "flows", type: "tree" },
  ];
  const files = {
    "flows/orders.yml": "schemaVersion: 1",
    "flows/examples/order-1.run.json": "{}",
    "services/pay/flows/pay.yaml": "schemaVersion: 1",
  };

  it("reads only YAML/JSON files in flow folders, from the default branch", async () => {
    const requests: string[] = [];
    const result = await fetchRepoFiles({ owner: "acme", repo: "shop" }, fakeGithub(tree, files, requests));
    expect(result.map((f) => f.path)).toEqual(["flows/orders.yml", "flows/examples/order-1.run.json", "services/pay/flows/pay.yaml"]);
    expect(requests.some((url) => url.includes("/trees/trunk?recursive=1"))).toBe(true);
    expect(requests.some((url) => url.includes("package.json") || url.includes("compose.yml"))).toBe(false);
  });

  it("reads a named folder and strips it from the paths", async () => {
    const result = await fetchRepoFiles({ owner: "acme", repo: "shop", ref: "dev", directory: "services/pay" }, fakeGithub(tree, files));
    expect(result).toEqual([{ path: "flows/pay.yaml", text: "schemaVersion: 1" }]);
  });

  it("explains a missing or rate-limited repository", async () => {
    const missing = (async () => new Response("", { status: 404 })) as typeof fetch;
    await expect(fetchRepoFiles({ owner: "acme", repo: "shop" }, missing)).rejects.toThrow("was not found");
    const limited = (async () => new Response("", { status: 403 })) as typeof fetch;
    await expect(fetchRepoFiles({ owner: "acme", repo: "shop", ref: "main" }, limited)).rejects.toThrow("rate limit");
  });
});
