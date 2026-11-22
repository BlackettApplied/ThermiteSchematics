// Shared, root-parameterized documentation inventory and Markdown navigation.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import GithubSlugger from "github-slugger";
import { parseHTML } from "linkedom";
import { fromMarkdown } from "mdast-util-from-markdown";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const finding = (file, line, target, reason) => ({
  file,
  line,
  target,
  reason,
});
export const normalizeText = (text) => text.replace(/\r\n/g, "\n");
export const readText = async (path) =>
  normalizeText(await readFile(path, "utf8"));
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function plain(node) {
  if (node.type === "html") return "";
  return node.value ?? node.alt ?? node.children?.map(plain).join("") ?? "";
}
function htmlAttributes(node) {
  const attributes = [];
  // Comments are not navigation. Preserve offsets for line reporting.
  const html = node.value.replace(/<!--[\s\S]*?-->/g, (s) =>
    s.replace(/[^\n]/g, " "),
  );
  for (const tag of html.matchAll(/<[a-z](?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const element = parseHTML(tag[0]).document.querySelector("*");
    if (!element) continue;
    for (const attr of tag[0].matchAll(
      /(?<=\s)(href|src|id|name)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    )) {
      const value =
        element.getAttribute(attr[1]) ??
        element.getAttribute(attr[1].toLowerCase());
      if (value === null) continue;
      attributes.push({
        kind: attr[1].toLowerCase(),
        value,
        line:
          node.position.start.line +
          html.slice(0, tag.index + attr.index).split("\n").length -
          1,
      });
    }
  }
  return attributes;
}
export function parseDocument(text) {
  const tree = fromMarkdown(text);
  const slugger = new GithubSlugger();
  const anchors = new Set();
  const links = [];
  const definitions = new Map();
  let title;
  walk(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if (node.type === "heading") {
      const label = plain(node);
      if (node.depth === 1 && title === undefined) title = label;
      anchors.add(slugger.slug(label));
    }
    if (node.type === "html")
      for (const attr of htmlAttributes(node))
        if (attr.kind === "id" || attr.kind === "name") anchors.add(attr.value);
  });
  walk(tree, (node) => {
    if (node.type === "link" || node.type === "image")
      links.push({ target: node.url, line: node.position.start.line });
    if (node.type === "linkReference" || node.type === "imageReference") {
      const target = definitions.get(node.identifier);
      if (target !== undefined)
        links.push({ target, line: node.position.start.line });
    }
    if (node.type === "html")
      for (const attr of htmlAttributes(node))
        if (attr.kind === "href" || attr.kind === "src")
          links.push({ target: attr.value, line: attr.line });
  });
  return { title, anchors, links, text };
}

export function excluded(file, policy) {
  const parts = file.split("/");
  return (
    parts.some((part) => policy.exclude.directoryNames.includes(part)) ||
    policy.exclude.prefixes.some(
      (prefix) => file === prefix || file.startsWith(`${prefix}/`),
    ) ||
    policy.exclude.files.includes(file) ||
    policy.exclude.patterns.some((pattern) => new RegExp(pattern).test(file))
  );
}
async function discover(root, policy, directory = "") {
  const files = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = posix.join(directory, entry.name);
    if (excluded(path, policy)) continue;
    if (entry.isDirectory())
      files.push(...(await discover(root, policy, path)));
    else if (/\.md$/i.test(path)) files.push(path);
  }
  return files.sort(compare);
}
function trackedMarkdown(root) {
  const probe = spawnSync("git", ["rev-parse", "--show-prefix"], {
    cwd: root,
    encoding: "utf8",
  });
  if (probe.error?.code === "ENOENT") return { available: false, files: [] };
  if (probe.status === 128 && !existsSync(join(root, ".git")))
    return { available: false, files: [] };
  if (probe.error || probe.status !== 0)
    throw new Error("Cannot inspect Git documentation inventory");
  if (probe.stdout.trim() !== "") return { available: false, files: [] };
  const result = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot list tracked documentation");
  return {
    available: true,
    files: result.stdout.split("\0").filter((file) => /\.md$/i.test(file)),
  };
}
export function ignoredTargets(root, files) {
  if (!files.length) return new Set();
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    encoding: "utf8",
    input: `${[...new Set(files)].join("\0")}\0`,
  });
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error("Cannot inspect Git-ignored documentation targets");
  return new Set(result.stdout.split("\0").filter(Boolean));
}
export async function loadCorpus(root = repositoryRoot) {
  const policy = JSON.parse(
    await readText(join(root, "scripts/docs-policy.json")),
  );
  const topics = JSON.parse(await readText(join(root, "docs/topics.json")));
  const files = await discover(root, policy);
  const inventory = trackedMarkdown(root);
  const findings = [];
  for (const file of inventory.files) {
    if (excluded(file, policy))
      findings.push(
        finding(file, 1, file, "tracked document is excluded by docs policy"),
      );
    else if (!files.includes(file))
      findings.push(
        finding(file, 1, file, "tracked source document is missing"),
      );
  }
  const documents = new Map();
  const physicalRoot = await realpath(root);
  for (const file of files) {
    if (outsideRoot(physicalRoot, await realpath(join(root, file)))) {
      findings.push(
        finding(file, 1, file, "source document is outside repository"),
      );
      continue;
    }
    documents.set(file, parseDocument(await readText(join(root, file))));
  }
  return {
    root,
    policy,
    topics,
    documents,
    findings,
    gitAvailable: inventory.available,
  };
}

function label(text) {
  return text.replace(/[\\[\]<>`]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
}
function indexLink(file, document) {
  const href = posix
    .relative("docs", file)
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(/[()]/g, (c) =>
        c === "(" ? "%28" : "%29",
      ),
    )
    .join("/");
  return `[${label(document.title ?? file)}](${href})`;
}
function indexGroup(lines, group, entries) {
  if (!entries.length) return;
  if (group.collapsible)
    lines.push("<details>", `<summary>${group.title}</summary>`, "");
  else lines.push(`## ${group.title}`, "");
  if (group.byLibrary) {
    const rootEntries = entries.filter(
      ([file]) => file.split("/").length === 2,
    );
    for (const [file, document] of rootEntries)
      lines.push(`- ${indexLink(file, document)}`);
    if (rootEntries.length) lines.push("");
    const libraries = [
      ...new Set(
        entries
          .filter(([file]) => file.split("/").length > 2)
          .map(([file]) => file.split("/")[1]),
      ),
    ];
    for (const library of libraries) {
      lines.push("<details>", `<summary>${library}</summary>`, "");
      for (const [file, document] of entries.filter(
        ([file]) => file.split("/")[1] === library,
      ))
        lines.push(`- ${indexLink(file, document)}`);
      lines.push("", "</details>", "");
    }
  } else {
    for (const [file, document] of entries)
      lines.push(`- ${indexLink(file, document)}`);
    lines.push("");
  }
  if (group.collapsible) lines.push("</details>", "");
}
export function generateIndex({ policy, topics, documents }) {
  const lines = [
    "# Documentation index",
    "",
    "<!-- Generated by bun scripts/docs-index.mjs --write. Do not edit. -->",
    "",
    "[Repository README](../README.md). Every source document is linked below.",
    "",
    "[Project JSON Schema](../packages/schema/schemas/project.schema.json).",
    "",
  ];
  const remaining = new Map(
    [...documents].filter(([file]) => file !== "docs/README.md"),
  );
  for (const group of policy.groups) {
    if (group.topics) {
      lines.push(`## ${group.title}`, "");
      for (const topic of topics) {
        const doc = documents.get(topic.file);
        if (!doc) continue;
        lines.push(
          `- ${indexLink(topic.file, doc)} — ${topic.title}. Command: \`thermite guide ${topic.id}\`. Read ${Array.isArray(topic.readBefore) ? topic.readBefore.join("; ") : "(invalid trigger metadata)"}.`,
        );
        remaining.delete(topic.file);
      }
      lines.push("");
      continue;
    }
    const entries = [...remaining].filter(([file]) =>
      new RegExp(group.pattern).test(file),
    );
    entries.sort(
      ([a, da], [b, db]) =>
        compare(da.title ?? a, db.title ?? b) || compare(a, b),
    );
    // Library grouping is path ordered, so each library is stable even when H1s change.
    if (group.byLibrary) entries.sort(([a], [b]) => compare(a, b));
    indexGroup(lines, group, entries);
    for (const [file] of entries) remaining.delete(file);
  }
  if (remaining.size)
    throw new Error(
      `Documentation policy has no group for ${[...remaining.keys()].join(", ")}`,
    );
  return `${lines.join("\n").trimEnd()}\n`;
}
export function indexFindings(corpus) {
  const actual = corpus.documents.get("docs/README.md")?.text;
  return actual === generateIndex(corpus)
    ? []
    : [
        finding(
          "docs/README.md",
          1,
          "docs/README.md",
          "index is stale; run bun scripts/docs-index.mjs --write",
        ),
      ];
}

function outsideRoot(root, target) {
  const rel = relative(root, target);
  // On Windows, a junction onto another drive produces an absolute relative
  // result instead of a path beginning with "..".
  return isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`);
}
async function pathCaseReason(root, file) {
  let directory = root;
  for (const part of file.split("/").filter((part) => part && part !== ".")) {
    const names = await readdir(directory);
    if (!names.includes(part))
      return names.some((name) => name.toLowerCase() === part.toLowerCase())
        ? "target path case does not match"
        : "missing local target";
    directory = join(directory, part);
  }
}
async function physicalTarget(root, file, fragment) {
  const reason = await pathCaseReason(root, file);
  if (reason) return { reason };
  const actual = await realpath(join(root, file));
  const physicalRoot = await realpath(root);
  if (outsideRoot(physicalRoot, actual))
    return { reason: "target is outside repository" };
  const physicalFile =
    relative(physicalRoot, actual).split(sep).join("/") || ".";
  if ((await stat(actual)).isDirectory()) {
    const names = await readdir(actual);
    const readme =
      names.find((name) => name === "README.md") ??
      names.find((name) => name.toLowerCase() === "readme.md");
    // A README may itself be a symlink or junction. Validate that physical
    // target too before using it for fragment checks or navigation.
    if (readme) return physicalTarget(root, posix.join(file, readme), fragment);
    return { file, physicalFile, fragment, markdown: false };
  }
  return { file, physicalFile, fragment, markdown: /\.md$/i.test(file) };
}
export async function resolveTarget(root, from, href) {
  if (/^file:/i.test(href))
    return { reason: "file URLs are not repository links" };
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return { external: true };
  const hash = href.indexOf("#");
  const path = (hash < 0 ? href : href.slice(0, hash)).split("?")[0];
  let decoded, fragment;
  try {
    decoded = decodeURIComponent(path);
    fragment = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  } catch {
    return { reason: "invalid URL encoding" };
  }
  const file = decoded
    ? posix.normalize(
        decoded.startsWith("/")
          ? decoded.slice(1)
          : posix.join(posix.dirname(from), decoded),
      )
    : from;
  if (
    file === ".." ||
    file.startsWith("../") ||
    decoded.includes("\\") ||
    decoded.includes("\0")
  )
    return { reason: "target is outside repository or has an invalid path" };
  try {
    return await physicalTarget(root, file, fragment);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      return { reason: "missing local target" };
    throw error;
  }
}
