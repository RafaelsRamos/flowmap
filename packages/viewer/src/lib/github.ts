import type { SourceFile } from "./workspace.js";

export interface RepoSpec {
  owner: string;
  repo: string;
  /** Branch, tag or commit; the repository's default branch when absent. */
  ref?: string;
  /** Only files under this folder are read. */
  directory?: string;
}

/** Parses `https://github.com/owner/repo[/tree/<ref>[/<dir>]]` or `owner/repo`. */
export function parseRepoSpec(input: string): RepoSpec | undefined {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(text);
  if (short?.[1] && short[2]) return { owner: short[1], repo: short[2] };
  try {
    const url = new URL(text);
    if (url.hostname !== "github.com") return undefined;
    const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return undefined;
    const spec: RepoSpec = { owner, repo };
    if (kind === "tree" && ref) {
      spec.ref = ref;
      if (rest.length > 0) spec.directory = rest.join("/");
    }
    return spec;
  } catch {
    return undefined;
  }
}

/** The plain repository URL, used as the base of code links. */
export function repoWebUrl(spec: RepoSpec): string {
  return `https://github.com/${spec.owner}/${spec.repo}`;
}

const MAX_FILES = 200;
const WANTED = /\.(ya?ml|json)$/i;
const FLOW_FOLDER = /(^|\/)flows?(\/|$)/i;

interface TreeEntry {
  path: string;
  type: string;
}

/**
 * Reads flow and run files from a public GitHub repository, straight from the
 * browser (no backend). Only YAML/JSON files in a `flow`/`flows` folder, or
 * under the folder named in the URL, are fetched, so a large repository does
 * not cost hundreds of requests. Private repositories are out of scope here.
 */
export async function fetchRepoFiles(spec: RepoSpec, fetchImpl: typeof fetch = fetch): Promise<SourceFile[]> {
  const ref = spec.ref ?? (await defaultBranch(spec, fetchImpl));
  const treeUrl = `https://api.github.com/repos/${spec.owner}/${spec.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const response = await fetchImpl(treeUrl, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(describeFailure(response.status, spec));
  const tree = (await response.json()) as { tree?: TreeEntry[] };

  const directory = spec.directory?.replace(/^\/+|\/+$/g, "");
  const wanted = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && WANTED.test(entry.path))
    .filter((entry) => (directory ? entry.path.startsWith(`${directory}/`) : FLOW_FOLDER.test(entry.path)))
    .slice(0, MAX_FILES);

  const files = await Promise.all(
    wanted.map(async (entry): Promise<SourceFile> => {
      const raw = await fetchImpl(
        `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${encodeURIComponent(ref)}/${entry.path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      );
      if (!raw.ok) throw new Error(`could not read ${entry.path} (HTTP ${raw.status})`);
      return { path: directory ? entry.path.slice(directory.length + 1) : entry.path, text: await raw.text() };
    }),
  );
  return files;
}

const MAX_TAGS = 100;

/** Tag names of a public repository, newest-looking first (version-aware descending order). */
export async function fetchTags(spec: Pick<RepoSpec, "owner" | "repo">, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const response = await fetchImpl(`https://api.github.com/repos/${spec.owner}/${spec.repo}/tags?per_page=${MAX_TAGS}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(describeFailure(response.status, { ...spec }));
  const tags = (await response.json()) as { name?: string }[];
  return tags
    .map((tag) => tag.name)
    .filter((name): name is string => typeof name === "string")
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

async function defaultBranch(spec: RepoSpec, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${spec.owner}/${spec.repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(describeFailure(response.status, spec));
  const info = (await response.json()) as { default_branch?: string };
  return info.default_branch ?? "main";
}

function describeFailure(status: number, spec: RepoSpec): string {
  if (status === 404) return `${spec.owner}/${spec.repo} was not found. Only public repositories can be opened from here.`;
  if (status === 403 || status === 429) return "GitHub's anonymous rate limit was reached; try again later or drop the folder instead.";
  return `GitHub answered HTTP ${status}.`;
}
