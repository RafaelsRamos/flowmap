export interface CodeAnchor {
  path: string;
  symbol?: string;
}

/** Splits `path/to/file.kt#symbol` into its parts. */
export function parseCodeAnchor(anchor: string): CodeAnchor {
  const hash = anchor.indexOf("#");
  return hash === -1 ? { path: anchor } : { path: anchor.slice(0, hash), symbol: anchor.slice(hash + 1) };
}

/** `https://github.com/acme/shop.git/` -> `https://github.com/acme/shop`; undefined when not an http(s) URL. */
export function normalizeRepoUrl(input: string): string | undefined {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Builds a link to the file a node's code anchor points at, from the repo URL
 * the user configured. `ref` is a branch, tag or commit; the symbol cannot be
 * turned into a line number without parsing the code, so it is shown beside
 * the link rather than in it.
 */
export function codeUrl(repoUrl: string | undefined, anchor: string, ref = "HEAD"): string | undefined {
  const base = repoUrl === undefined ? undefined : normalizeRepoUrl(repoUrl);
  if (base === undefined) return undefined;
  const { path } = parseCodeAnchor(anchor);
  const separator = new URL(base).hostname.includes("gitlab") ? "/-/blob/" : "/blob/";
  return `${base}${separator}${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** A commit from a run's `flowRevision` such as `git:3f2a9c1`, else undefined. */
export function revisionRef(flowRevision: string | undefined): string | undefined {
  const match = /^git:([0-9a-f]{7,40})$/.exec(flowRevision ?? "");
  return match?.[1];
}
