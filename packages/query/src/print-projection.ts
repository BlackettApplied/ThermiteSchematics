import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrProjectRelation,
} from "@thermite/compiler";

/** Report identity and its indivisible printed markings for a source relation. */
export function relationPrintIdentity(
  relation: Readonly<IrProjectRelation>,
  devices: ReadonlyMap<string, Pick<IrDevice, "designation">>,
  output?: "print" | "csv",
) {
  const designation = relation.designation?.trim();
  if (designation) return { text: designation, identifiers: [designation] };
  const ports = relation.assembly ?? relation.connection;
  const from = devices.get(relation.fromDeviceUid)?.designation;
  const to = devices.get(relation.toDeviceUid)?.designation;
  if (from && to && ports?.fromPort && ports.toPort) {
    const separator = relation.connection && output !== "csv" ? ": " : ".";
    const identifiers = [
      `${from}${separator}${ports.fromPort}`,
      `${to}${separator}${ports.toPort}`,
    ];
    return { text: identifiers.join(" ↔ "), identifiers };
  }
  return { text: relation.description?.trim() ?? "", identifiers: [] };
}

/** A shared letter prefix plus separated integer suffixes reads as a range. */
function rangeLikePair(terminals: readonly string[]) {
  if (terminals.length !== 2) return false;
  const [first, second] = terminals.map((t) => /^(\p{L}*)(\d+)$/u.exec(t));
  const a = first?.[2],
    b = second?.[2];
  if (a === undefined || b === undefined || first?.[1] !== second?.[1])
    return false;
  const difference = BigInt(a) - BigInt(b);
  return difference > 1n || difference < -1n;
}

/** Authored identities are indivisible; punctuation is a list separator only. */
export function formatTerminalSet(
  terminals: readonly string[],
  label: (terminal: string) => string = (terminal) => terminal,
): string {
  const printed = terminals.map(label);
  const separator =
    terminals.length === 2 &&
    !rangeLikePair(terminals) &&
    printed.every((t) => !/[-–−+]/u.test(t))
      ? "–"
      : printed.some((t) => t.includes("/"))
        ? ", "
        : " / ";
  return printed.join(separator);
}

/** Port keys are authored markings. Descriptions supplement, never replace, them. */
export function printedPort(
  type: Pick<IrDeviceType, "ports"> | undefined,
  key: string,
): string {
  const description = type?.ports?.[key]?.description?.trim();
  return description && description !== key ? `${key} — ${description}` : key;
}

export function printedPortEndpoint(
  ir: Readonly<ElectricalIr>,
  uid: string,
  key: string,
  projection: "described" | "identity" = "described",
): string {
  const device = ir.devices.find((d) => d.uid === uid);
  const type = ir.deviceTypes.find((t) => t.id === device?.typeId);
  return `${device?.designation ?? "Device unspecified"}: ${projection === "identity" ? key : printedPort(type, key)}`;
}

// Explicit locale keeps segmentation independent of the host's default locale.
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const words = new Intl.Segmenter("en", { granularity: "word" });
const TYPE_TEXT_LIMIT = 160;
// Bound only print text; a fitting single line, including its qualifiers, is exact.
const printedTypeDescription = (text: string) => {
  const first =
    text.split(/[\n\u2028\u2029]/u).find((line) => line.trim()) ?? "";
  if (
    first.trim() === text.trim() &&
    [...first.trim()].length <= TYPE_TEXT_LIMIT
  )
    return first.trim();
  const omit = (prefix: string) =>
    `${prefix.trimEnd().replace(/[.…]+$/u, "")}…`;
  if ([...first].length < TYPE_TEXT_LIMIT) return omit(first);
  let end = 0,
    count = 0;
  const boundaries = new Set([0]);
  for (const part of graphemes.segment(first)) {
    count += [...part.segment].length;
    if (count >= TYPE_TEXT_LIMIT) break;
    end = part.index + part.segment.length;
    boundaries.add(end);
  }
  let sentenceEnd = 0;
  for (const part of first.matchAll(/[.!?](?=\s|$)/gu)) {
    const candidate = part.index + part[0].length;
    if (candidate > end) break;
    if (boundaries.has(candidate)) sentenceEnd = candidate;
  }
  if (sentenceEnd) return omit(first.slice(0, sentenceEnd));
  let wordEnd = 0;
  for (const part of words.segment(first)) {
    const candidate = part.index + part.segment.length;
    if (candidate > end) break;
    if (part.isWordLike && boundaries.has(candidate)) wordEnd = candidate;
  }
  // A single overlong word/symbol sequence has no usable word boundary.
  return omit(first.slice(0, wordEnd || end));
};

export function reportTypeProjection(output?: "print" | "csv") {
  let shortenedType = false,
    missingType = false;
  const typeDescription = (value: string | undefined, fallback: string) => {
    const authored =
      value !== undefined &&
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, " ").trim()
        ? value
        : undefined;
    if (authored === undefined) {
      missingType = true;
      return output === "csv" ? fallback : "Type description not specified";
    }
    const text = authored.replace(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,
      " ",
    );
    if (output === "csv") return text;
    const preview = printedTypeDescription(text);
    shortenedType ||= preview.trim() !== text.trim();
    return preview;
  };
  const typeNote = () =>
    [
      ...(shortenedType
        ? [
            "Type description shortened; full text: thermite inspect <designation> --type-description.",
          ]
        : []),
      ...(missingType
        ? [
            output === "csv"
              ? "No type description: type ID shown."
              : "Type description not specified.",
          ]
        : []),
    ].join(" ");
  return { describe: typeDescription, note: typeNote };
}
