import { posix } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes, Definition } from "mdast";

import type { GuideTopic } from "./alpha-guide.js";

interface Edit {
  start: number;
  end: number;
  value: string;
}
const offset = (node: Nodes, end = false) =>
  (end ? node.position?.end.offset : node.position?.start.offset)!;
function apply(
  markdown: string,
  edits: Edit[],
  start = 0,
  end = markdown.length,
) {
  let result = markdown.slice(start, end);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result =
      result.slice(0, edit.start - start) +
      edit.value +
      result.slice(edit.end - start);
  return result;
}
const urlPart = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const titleSuffix = (title: string | null | undefined) =>
  title ? ` ${JSON.stringify(title)}` : "";

/** Parse CommonMark and edit only link nodes, preserving all code and other bytes. */
export function rewriteGuideLinks(
  markdown: string,
  topic: GuideTopic,
  topics: readonly GuideTopic[],
  commit: string,
): string {
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, Definition>();
  function collect(node: Nodes): void {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);
  function destination(url: string) {
    if (/^(?:https:|#)/i.test(url)) return { url };
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(url))
      throw new Error(`Unsupported guide link protocol: ${url}`);
    const [pathname] = url.split(/[?#]/);
    const path = posix.normalize(
      posix.join(posix.dirname(topic.file), decodeURIComponent(pathname!)),
    );
    if (path.startsWith("../") || path.startsWith("/"))
      throw new Error(`Guide link escapes repository: ${url}`);
    const shipped = topics.find((t) => t.file === path);
    const section = url.includes("#")
      ? decodeURIComponent(url.slice(url.indexOf("#") + 1))
      : "";
    if (shipped)
      return {
        url,
        command: `\`thermite guide ${shipped.id}\`${section ? `, section \`${section}\`` : ""}`,
      };
    return {
      url: `https://github.com/BlackettApplied/ThermiteSchematics/blob/${commit}/${path.split("/").map(urlPart).join("/")}${section ? `#${urlPart(section)}` : ""}`,
    };
  }
  function edits(node: Nodes): Edit[] {
    if (node.type === "code" || node.type === "inlineCode") return [];
    if (node.type === "definition") {
      const target = destination(node.url);
      return [
        {
          start: offset(node),
          end: offset(node, true),
          value: target.command
            ? ""
            : `[${node.label ?? node.identifier}]: ${target.url}${titleSuffix(node.title)}`,
        },
      ];
    }
    if (node.type === "link" || node.type === "linkReference") {
      const definition =
        node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
      const url = node.type === "link" ? node.url : definition?.url;
      if (url === undefined) return [];
      const target = destination(url);
      const children = node.children.flatMap(edits);
      if (target.command || (node.type === "link" && target.url !== url)) {
        const start = offset(node) + 1;
        const end = node.children.length
          ? offset(node.children.at(-1)!, true)
          : start;
        const label = apply(markdown, children, start, end);
        return [
          {
            start: offset(node),
            end: offset(node, true),
            value: target.command
              ? `${label} (${target.command})`
              : `[${label}](${target.url}${titleSuffix(node.type === "link" ? node.title : definition?.title)})`,
          },
        ];
      }
      return children;
    }
    if (node.type === "image") {
      const target = destination(node.url);
      if (target.command)
        throw new Error(`A guide topic cannot be an image: ${node.url}`);
      if (target.url !== node.url)
        return [
          {
            start: offset(node),
            end: offset(node, true),
            value: `![${node.alt ?? ""}](${target.url}${titleSuffix(node.title)})`,
          },
        ];
    }
    return "children" in node ? node.children.flatMap(edits) : [];
  }
  const result = apply(markdown, edits(tree));
  assertGuideLinksResolved(result);
  return result;
}

/** A guard on actual Markdown targets; code examples are deliberately excluded. */
export function assertGuideLinksResolved(markdown: string): void {
  function visit(node: Nodes): void {
    if (
      (node.type === "link" ||
        node.type === "image" ||
        node.type === "definition") &&
      !/^(?:https:|#)/i.test(node.url)
    )
      throw new Error(`Unresolved guide link: ${node.url}`);
    if (node.type === "html") {
      for (const match of node.value.matchAll(
        /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      )) {
        const target = match[1] ?? match[2] ?? match[3]!;
        if (!/^(?:https:|#)/i.test(target))
          throw new Error(`Unresolved guide HTML link: ${target}`);
      }
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(markdown));
}
