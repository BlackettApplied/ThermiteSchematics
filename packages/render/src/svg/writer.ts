import { compareText } from "../ordering.js";
import { escapeXmlAttribute, escapeXmlText } from "./escape.js";
import { formatSvgNumber } from "./numbers.js";

type SvgElementName =
  | "circle"
  | "clipPath"
  | "defs"
  | "desc"
  | "g"
  | "line"
  | "path"
  | "polyline"
  | "rect"
  | "style"
  | "svg"
  | "text"
  | "title";

type SvgAttributeName =
  | "aria-label"
  | "class"
  | "clip-path"
  | "clipPathUnits"
  | "cx"
  | "cy"
  | "d"
  | `data-${string}`
  | "dominant-baseline"
  | "fill"
  | "font-family"
  | "font-weight"
  | "font-size"
  | "height"
  | "id"
  | "lengthAdjust"
  | "points"
  | "r"
  | "role"
  | "rx"
  | "ry"
  | "stroke"
  | "stroke-linecap"
  | "stroke-linejoin"
  | "stroke-dasharray"
  | "stroke-width"
  | "text-anchor"
  | "textLength"
  | "transform"
  | "version"
  | "viewBox"
  | "width"
  | "x"
  | "x1"
  | "x2"
  | "xmlns"
  | "y"
  | "y1"
  | "y2";

type SvgAttributeValue = string | number | undefined;
export type SvgAttributes = Readonly<
  Partial<Record<SvgAttributeName, SvgAttributeValue>>
>;

const FIXED_ATTRIBUTE_ORDER = Object.freeze([
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
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "textLength",
  "lengthAdjust",
  "role",
  "aria-label",
] as const satisfies readonly Exclude<SvgAttributeName, `data-${string}`>[]);

const FIXED_DATA_ATTRIBUTE_ORDER = Object.freeze([
  "data-mechanical-association",
  "data-ganged-functions",
  "data-location",
  "data-virtual-location",
  "data-boundary-kind",
  "data-device-uid",
  "data-designation",
  "data-type-id",
  "data-function-key",
  "data-aggregate-key",
  "data-terminal-key",
  "data-member-function-key",
  "data-net-id",
  "data-potential-uid",
  "data-potential-name",
  "data-wire-uid",
  "data-jumper-uid",
  "data-cable-uid",
  "data-conductor-id",
  "data-presentation-only",
] as const);

const PREFIXED_DATA_ATTRIBUTE_ORDER = Object.freeze([
  "data-project-name",
  "data-project-revision",
  "data-tool-version",
  "data-view-format",
  "data-view-family",
  "data-view-intent",
  "data-view-flow",
  "data-renderer-version",
  "data-symbol-catalog-version",
] as const);

function dataAttributeRank(name: string): number {
  if (name.startsWith("data-view-")) return 0;
  if (name.startsWith("data-renderer-")) return 1;
  if (name.startsWith("data-symbol-")) return 2;
  const fixed = FIXED_DATA_ATTRIBUTE_ORDER.indexOf(
    name as (typeof FIXED_DATA_ATTRIBUTE_ORDER)[number],
  );
  return fixed < 0 ? 100 : fixed + 3;
}

function compareAttributeNames(left: string, right: string): number {
  const leftFixed = FIXED_ATTRIBUTE_ORDER.indexOf(
    left as (typeof FIXED_ATTRIBUTE_ORDER)[number],
  );
  const rightFixed = FIXED_ATTRIBUTE_ORDER.indexOf(
    right as (typeof FIXED_ATTRIBUTE_ORDER)[number],
  );
  if (leftFixed >= 0 || rightFixed >= 0) {
    return (
      (leftFixed < 0 ? 1_000 : leftFixed) -
      (rightFixed < 0 ? 1_000 : rightFixed)
    );
  }
  const leftPrefixed = PREFIXED_DATA_ATTRIBUTE_ORDER.indexOf(left as never);
  const rightPrefixed = PREFIXED_DATA_ATTRIBUTE_ORDER.indexOf(right as never);
  if (leftPrefixed >= 0 && rightPrefixed >= 0)
    return leftPrefixed - rightPrefixed;
  const rank = dataAttributeRank(left) - dataAttributeRank(right);
  return rank || compareText(left, right);
}

function serializedAttributes(attributes: SvgAttributes): string {
  return Object.entries(attributes)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .sort(([left], [right]) => compareAttributeNames(left, right))
    .map(([name, raw]) => {
      if (
        !name.startsWith("data-") &&
        !FIXED_ATTRIBUTE_ORDER.includes(name as never)
      ) {
        throw new Error(`SVG emitter rejected attribute ${name}.`);
      }
      const value = typeof raw === "number" ? formatSvgNumber(raw) : raw;
      return ` ${name}="${escapeXmlAttribute(value)}"`;
    })
    .join("");
}

export class SvgWriter {
  readonly lines: string[] = [];

  element(
    indent: number,
    name: SvgElementName,
    attributes: SvgAttributes = {},
    text?: string,
  ): void {
    const prefix = "  ".repeat(indent);
    const attrs = serializedAttributes(attributes);
    this.lines.push(
      text === undefined
        ? `${prefix}<${name}${attrs}/>`
        : `${prefix}<${name}${attrs}>${escapeXmlText(text)}</${name}>`,
    );
  }

  open(
    indent: number,
    name: SvgElementName,
    attributes: SvgAttributes = {},
  ): void {
    this.lines.push(
      `${"  ".repeat(indent)}<${name}${serializedAttributes(attributes)}>`,
    );
  }

  close(indent: number, name: SvgElementName): void {
    this.lines.push(`${"  ".repeat(indent)}</${name}>`);
  }

  finish(): string {
    return `${this.lines.join("\n")}\n`;
  }
}
