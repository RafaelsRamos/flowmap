import type { SourceFile } from "./workspace.js";

// The File and Directory Entries API is not in the standard DOM typings.
interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, failure: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, failure: (error: unknown) => void) => void };
}

const SKIPPED = new Set(["node_modules", ".git"]);
const WANTED = /\.(ya?ml|json)$/i;

/** Reads every YAML/JSON file in a drop of files and folders. */
export async function readDropped(transfer: DataTransfer): Promise<SourceFile[]> {
  const entries: Entry[] = [];
  for (const item of Array.from(transfer.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return readFileList(transfer.files);
  const nested = await Promise.all(entries.map((entry) => walk(entry, "")));
  return nested.flat();
}

/** Reads files from `<input type="file">`, with `webkitdirectory` or without. */
export async function readFileList(list: FileList): Promise<SourceFile[]> {
  const files = Array.from(list).filter((file) => WANTED.test(file.name));
  return Promise.all(
    files.map(async (file) => ({
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      text: await file.text(),
    })),
  );
}

async function walk(entry: Entry, parent: string): Promise<SourceFile[]> {
  const path = parent === "" ? entry.name : `${parent}/${entry.name}`;
  if (entry.isFile && entry.file) {
    if (!WANTED.test(entry.name)) return [];
    const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
    return [{ path, text: await file.text() }];
  }
  if (entry.isDirectory && entry.createReader && !SKIPPED.has(entry.name)) {
    const reader = entry.createReader();
    const children: Entry[] = [];
    // readEntries returns results in batches; keep going until it returns none.
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      children.push(...batch);
    }
    return (await Promise.all(children.map((child) => walk(child, path)))).flat();
  }
  return [];
}
