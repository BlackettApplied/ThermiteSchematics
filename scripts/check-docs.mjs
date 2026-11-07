import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compare,
  excluded,
  finding,
  ignoredTargets,
  indexFindings,
  loadCorpus,
  parseDocument,
  readText,
  repositoryRoot,
  resolveTarget,
  sha256,
} from "./docs-lib.mjs";

function topicFindings({ topics, documents }) {
  const findings = [];
  const ids = new Set(["symbols", "diagnostics", "schema"]);
  for (const topic of topics) {
    const valid =
      /^[a-z][a-z0-9-]*$/.test(topic.id) &&
      !ids.has(topic.id) &&
      typeof topic.title === "string" &&
      topic.title.trim() &&
      Array.isArray(topic.readBefore) &&
      topic.readBefore.length &&
      topic.readBefore.every(
        (trigger) =>
          typeof trigger === "string" && trigger.startsWith("before "),
      ) &&
      new Set(topic.readBefore).size === topic.readBefore.length;
    if (!valid)
      findings.push(
        finding(
          "docs/topics.json",
          1,
          String(topic.id),
          "invalid or duplicate guide topic",
        ),
      );
    if (
      !/^docs\/[a-z0-9-]+\.md$/.test(topic.file) ||
      !documents.has(topic.file)
    )
      findings.push(
        finding(
          "docs/topics.json",
          1,
          String(topic.file),
          "topic is not a source document",
        ),
      );
    ids.add(topic.id);
  }
  return findings;
}
function legacyScanLine(file, line, number, document) {
  // A factual title pointing into the archive is allowed. Installation commands
  // and runtime constraints still match after removing that title, even on the
  // same line. Code has no link nodes, so it cannot claim this exception.
  const archivePointer = document.links.some((link) => {
    if (link.line !== number || /^[a-z][a-z\d+.-]*:|^\/\//i.test(link.target))
      return false;
    try {
      const path = decodeURIComponent(link.target.split(/[?#]/)[0]);
      const target = posix.normalize(
        path.startsWith("/")
          ? path.slice(1)
          : posix.join(posix.dirname(file), path),
      );
      return target.startsWith("docs/legacy/");
    } catch {
      return false;
    }
  });
  return archivePointer
    ? line.replace(
        /Historical private 0\.2\.0 (?:runtime|packaging)/gi,
        "archive",
      )
    : line;
}
function legacyLines(text) {
  const lines = text.split("\n");
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    const number = index + 1;
    let line = lines[index];
    // Check continued shell commands together without losing the first line
    // used by diagnostics. Code fences remain part of the scanned raw text.
    while (/\\[ \t]*$/.test(line) && index + 1 < lines.length)
      line = line.replace(/\\[ \t]*$/, " ") + lines[++index];
    result.push({ number, line });
  }
  return result;
}
function legacyFindings({ policy, documents }) {
  const findings = [];
  const { frozenFile, frozenSha256, patterns, baseline } = policy.legacy;
  const remaining = baseline.map((entry) => ({ ...entry }));
  const pattern = new RegExp(patterns.join("|"), "i");
  for (const [file, document] of documents) {
    if (file === frozenFile) {
      if (sha256(document.text) !== frozenSha256)
        findings.push(
          finding(file, 1, file, "frozen legacy asset SHA-256 changed"),
        );
      continue;
    }
    if (file.startsWith("docs/legacy/")) continue;
    for (const { number, line } of legacyLines(document.text)) {
      if (!pattern.test(legacyScanLine(file, line, number, document))) continue;
      const known = remaining.findIndex(
        (entry) => entry.file === file && entry.text === line,
      );
      if (known >= 0) remaining.splice(known, 1);
      else
        findings.push(
          finding(
            file,
            number,
            line.trim(),
            "legacy instruction outside archive (new or changed baseline match)",
          ),
        );
    }
  }
  // A removal must also remove its baseline entry.
  for (const entry of remaining)
    findings.push(
      finding(
        entry.file,
        1,
        entry.text,
        "legacy baseline is stale; remove the resolved entry",
      ),
    );
  return findings;
}
async function localLinks({ root, policy, documents }, findings) {
  const links = [];
  for (const [file, document] of documents) {
    for (const link of document.links) {
      const target = await resolveTarget(root, file, link.target);
      if (target.external) continue;
      if (target.reason) {
        findings.push(finding(file, link.line, link.target, target.reason));
        continue;
      }
      if (excluded(target.file, policy)) {
        findings.push(
          finding(
            file,
            link.line,
            link.target,
            "local target is excluded by docs policy",
          ),
        );
        continue;
      }
      links.push({ file, link, target });
    }
  }
  return links;
}
async function linkGraph(corpus, findings) {
  const { root, documents, gitAvailable } = corpus;
  const edges = new Map([...documents.keys()].map((file) => [file, new Set()]));
  const anchors = new Map(
    [...documents].map(([file, document]) => [file, document.anchors]),
  );
  const links = await localLinks(corpus, findings);
  const ignored = gitAvailable
    ? ignoredTargets(
        root,
        links.map(({ target }) => target.physicalFile),
      )
    : new Set();
  for (const { file, link, target } of links) {
    if (ignored.has(target.physicalFile)) {
      findings.push(
        finding(file, link.line, link.target, "local target is ignored by Git"),
      );
      continue;
    }
    if (target.markdown && target.fragment) {
      if (!anchors.has(target.file))
        anchors.set(
          target.file,
          parseDocument(await readText(join(root, target.file))).anchors,
        );
      if (!anchors.get(target.file).has(target.fragment))
        findings.push(
          finding(file, link.line, link.target, "missing Markdown fragment"),
        );
    }
    if (target.file !== file && documents.has(target.file))
      edges.get(file).add(target.file);
  }
  return edges;
}
function navigationFindings(documents, edges) {
  const findings = [];
  const inbound = new Set(
    [...edges.values()].flatMap((targets) => [...targets]),
  );
  const depths = new Map([["README.md", 0]]);
  const queue = ["README.md"];
  for (const source of queue)
    for (const target of edges.get(source) ?? [])
      if (!depths.has(target)) {
        depths.set(target, depths.get(source) + 1);
        queue.push(target);
      }
  if (!documents.has("README.md"))
    findings.push(finding("README.md", 1, "README.md", "missing root README"));
  for (const file of documents.keys()) {
    if (file !== "README.md" && !inbound.has(file))
      findings.push(
        finding(file, 1, file, "orphan: no inbound source-document link"),
      );
    if (!depths.has(file))
      findings.push(finding(file, 1, file, "unreachable from root README"));
    else if (depths.get(file) > 2)
      findings.push(
        finding(
          file,
          1,
          file,
          `README link depth ${depths.get(file)} exceeds 2`,
        ),
      );
  }
  return findings;
}
export async function checkDocs(root = repositoryRoot) {
  const corpus = await loadCorpus(root);
  const findings = [
    ...corpus.findings,
    ...indexFindings(corpus),
    ...topicFindings(corpus),
    ...legacyFindings(corpus),
  ];
  const edges = await linkGraph(corpus, findings);
  findings.push(...navigationFindings(corpus.documents, edges));
  return sortFindings(findings);
}
export function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      compare(a.file, b.file) ||
      a.line - b.line ||
      compare(a.target, b.target) ||
      compare(a.reason, b.reason),
  );
}
export function printFindings(findings) {
  for (const entry of findings)
    console.log(
      `${entry.file}:${entry.line} ${entry.target.replace(/\s+/g, " ")} ${entry.reason}`,
    );
}
export function commandArguments(args, { write = false } = {}) {
  let root = repositoryRoot;
  let mode = "--check";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root" && args[index + 1]) root = resolve(args[++index]);
    else if (arg === "--check" || (write && arg === "--write")) mode = arg;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return { root, mode };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { root } = commandArguments(process.argv.slice(2));
    const findings = await checkDocs(root);
    printFindings(findings);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`check-docs: ${error.message}`);
    process.exitCode = 2;
  }
}
