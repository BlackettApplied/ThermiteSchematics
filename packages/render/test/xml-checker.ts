const ELEMENTS = new Set([
  "svg",
  "title",
  "desc",
  "style",
  "defs",
  "clipPath",
  "g",
  "path",
  "line",
  "polyline",
  "rect",
  "circle",
  "text",
]);

const ATTRIBUTES = new Set([
  "xmlns",
  "version",
  "viewBox",
  "width",
  "height",
  "id",
  "class",
  "clipPathUnits",
  "clip-path",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "font-family",
  "font-size",
  "text-anchor",
  "dominant-baseline",
  "textLength",
  "lengthAdjust",
  "role",
  "aria-label",
]);

const ENTITY = /&(?:amp|lt|gt|quot|#x[0-9a-fA-F]+);/g;

export interface RestrictedXmlCheck {
  readonly elementNames: readonly string[];
  readonly ids: readonly string[];
  readonly clipIds: readonly string[];
  readonly clipReferences: readonly string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Restricted XML check failed: ${message}`);
}

function legalXmlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return false;
      index++;
      continue;
    }
    if (first >= 0xdc00 && first <= 0xdfff) return false;
    if (first === 0x9 || first === 0xa || first === 0xd) continue;
    if (
      (first >= 0x20 && first <= 0xd7ff) ||
      (first >= 0xe000 && first <= 0xfffd)
    )
      continue;
    return false;
  }
  return true;
}

function validateEntities(value: string): void {
  const without = value.replace(ENTITY, "");
  assert(!without.includes("&"), "invalid entity syntax");
  for (const match of value.matchAll(ENTITY)) {
    if (!match[0].startsWith("&#x")) continue;
    const codePoint = Number.parseInt(match[0].slice(3, -1), 16);
    assert(
      codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff),
      "numeric entity denotes an XML-illegal code point",
    );
  }
}

function attributes(source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  const pattern = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gy;
  let position = 0;
  while (position < source.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    assert(match !== null, "attribute is not double-quoted or is malformed");
    const name = match[1]!;
    const value = match[2]!;
    assert(
      ATTRIBUTES.has(name) || name.startsWith("data-"),
      `attribute ${name} is not whitelisted`,
    );
    assert(result[name] === undefined, `attribute ${name} is duplicated`);
    assert(
      legalXmlCharacters(value),
      `attribute ${name} has an illegal character`,
    );
    validateEntities(value);
    result[name] = value;
    position = pattern.lastIndex;
  }
  return result;
}

export function checkRestrictedSvgXml(svg: string): RestrictedXmlCheck {
  assert(
    svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'),
    "XML declaration is not canonical",
  );
  assert(
    svg.endsWith("\n") && !svg.endsWith("\n\n"),
    "document must have exactly one final LF",
  );
  assert(
    !svg.includes("\r") && !svg.includes("\t"),
    "document contains a literal CR or tab",
  );
  assert(
    !svg.includes("<!DOCTYPE") && !svg.includes("<!--"),
    "DOCTYPE or comment is forbidden",
  );
  assert(legalXmlCharacters(svg), "document contains an XML-illegal character");

  const body = svg.slice('<?xml version="1.0" encoding="UTF-8"?>\n'.length);
  const token = /<[^>]+>|[^<]+/g;
  const stack: { name: string; clipRectCount: number }[] = [];
  const elementNames: string[] = [];
  const ids: string[] = [];
  const clipIds: string[] = [];
  const clipReferences: string[] = [];
  let position = 0;
  let rootCount = 0;

  for (const match of body.matchAll(token)) {
    assert(match.index === position, "tokenizer skipped input");
    position = match.index + match[0].length;
    const value = match[0];
    if (!value.startsWith("<")) {
      if (stack.length === 0) {
        assert(
          value === "\n" && position === body.length,
          "text occurs outside the root",
        );
        continue;
      }
      assert(legalXmlCharacters(value), "text contains an illegal character");
      validateEntities(value);
      continue;
    }
    if (value.startsWith("</")) {
      const closing = /^<\/([A-Za-z][A-Za-z0-9]*)>$/.exec(value);
      assert(closing !== null, "closing tag is malformed");
      const frame = stack.pop();
      assert(
        frame?.name === closing[1],
        `closing tag ${closing[1]} is unbalanced`,
      );
      if (frame.name === "clipPath") {
        assert(
          frame.clipRectCount === 1,
          "clipPath must contain exactly one rect",
        );
      }
      continue;
    }

    const opening = /^<([A-Za-z][A-Za-z0-9]*)([\s\S]*?)(\/?)>$/.exec(value);
    assert(opening !== null, "opening tag is malformed");
    const name = opening[1]!;
    assert(ELEMENTS.has(name), `element ${name} is not whitelisted`);
    const attrs = attributes(opening[2]!);
    const selfClosing = opening[3] === "/";
    elementNames.push(name);
    if (stack.length === 0) {
      rootCount++;
      assert(name === "svg", "root element is not svg");
      assert(
        attrs.xmlns === "http://www.w3.org/2000/svg",
        "root namespace is missing",
      );
      assert(attrs.version === "1.1", "SVG version is not 1.1");
    }
    if (attrs.id !== undefined) {
      assert(!ids.includes(attrs.id), `ID ${attrs.id} is duplicated`);
      ids.push(attrs.id);
    }
    if (name === "clipPath") {
      assert(attrs.id !== undefined, "clipPath has no ID");
      assert(
        attrs.clipPathUnits === "userSpaceOnUse",
        "clipPath units are not userSpaceOnUse",
      );
      clipIds.push(attrs.id);
    }
    if (attrs["clip-path"] !== undefined) {
      const reference = /^url\(#([^)]*)\)$/.exec(attrs["clip-path"]);
      assert(reference !== null, "clip reference is malformed");
      clipReferences.push(reference[1]!);
    }
    const parent = stack[stack.length - 1];
    if (name === "rect" && parent?.name === "clipPath") parent.clipRectCount++;
    if (!selfClosing) stack.push({ name, clipRectCount: 0 });
  }

  assert(position === body.length, "tokenizer did not consume the document");
  assert(stack.length === 0, "document has unclosed elements");
  assert(rootCount === 1, "document must have one root");
  assert(
    clipIds.length === clipReferences.length,
    "clip definitions and references differ",
  );
  assert(
    new Set(clipReferences).size === clipReferences.length,
    "clip reference is reused",
  );
  assert(
    [...clipIds]
      .sort()
      .every((id, index) => id === [...clipReferences].sort()[index]),
    "clip references do not resolve one-to-one",
  );
  return { elementNames, ids, clipIds, clipReferences };
}
