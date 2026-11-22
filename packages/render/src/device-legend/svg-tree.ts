import { required } from "../presentation/util.js";
/** Reader for our generated SVG, never for project/source XML. */
export interface SvgNode {
  name: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  text: string;
}
export function unescape(value: string) {
  return value.replace(
    /&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
    (_, numeric: string, named: string) =>
      numeric
        ? String.fromCodePoint(
            Number.parseInt(
              numeric.replace(/^x/i, ""),
              /^x/i.test(numeric) ? 16 : 10,
            ),
          )
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
            named.toLowerCase()
          ] ?? ""),
  );
}
export function svgTree(svg: string): SvgNode {
  const root: SvgNode = { name: "document", attrs: {}, children: [], text: "" },
    stack = [root];
  for (const token of svg.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    const parent = required(stack.at(-1), "Missing legend geometry");
    if (!token.startsWith("<")) {
      parent.text += unescape(token);
      continue;
    }
    const name = /^<([^\s/>]+)/.exec(token)?.[1];
    if (!name) throw Error("Invalid generated SVG element");
    const attrs = Object.fromEntries(
      [...token.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [
        required(m[1], "Missing legend geometry"),
        unescape(required(m[2], "Missing legend geometry")),
      ]),
    );
    const node = { name, attrs, children: [], text: "" };
    parent.children.push(node);
    if (!token.endsWith("/>")) stack.push(node);
  }
  if (stack.length !== 1) throw Error("Unbalanced generated SVG");
  return root;
}
export function descendants(n: SvgNode): SvgNode[] {
  return n.children.flatMap((c) => [c, ...descendants(c)]);
}
export function svgStyles(root: SvgNode) {
  const styles = new Map<string, Record<string, string>>();
  for (const node of descendants(root).filter((n) => n.name === "style"))
    for (const rule of node.text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      for (const cls of required(rule[1], "Missing legend geometry")
        .split(",")
        .map((s) => s.trim()))
        if (/^\.[\w-]+$/.test(cls))
          styles.set(
            cls.slice(1),
            declarations(required(rule[2], "Missing legend geometry")),
          );
  return styles;
}
export function declarations(text: string) {
  return Object.fromEntries(
    text
      .split(";")
      .filter((v) => v.includes(":"))
      .map((v) => {
        const i = v.indexOf(":");
        return [v.slice(0, i).trim(), v.slice(i + 1).trim()];
      }),
  );
}
