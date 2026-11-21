import type { ElectricalIr } from "@thermite/compiler";
import type {
  Draft,
  PaperPage,
  RenderedSheet,
  DrawingBounds,
} from "./types.js";
import type { DocumentDependency } from "./document-types.js";
import type {
  AnnotationReservation,
  NavigationShape,
} from "./navigation-types.js";
import {
  assemblyPortGeometry,
  connectorPortKey,
} from "./document-assembly-geometry.js";
import { wrapDocumentTokens } from "./document-caption-text.js";
import { destinationToken } from "./navigation-location.js";
import {
  allocateNavigationSlots,
  NavigationSlotFailure,
} from "./navigation-slots.js";
import { DocumentDependencyError } from "./document-error.js";
import { printableTextMetrics } from "../text-metrics.js";
import { text } from "./svg.js";
import { required } from "../presentation/util.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

function pointerReservation(
  id: string,
  tokens: readonly string[],
  width: number,
): AnnotationReservation {
  const shapes: NavigationShape[] = [];
  for (const w of [
    ...new Set([width, Math.min(width, 160), Math.min(width, 100)]),
  ]) {
    if (tokens.some((t) => printableTextMetrics(t, 2.5).advance > w - 2))
      continue;
    const lines = wrapDocumentTokens(tokens, w - 2);
    shapes.push({
      id: String(w),
      mode: "self-located",
      inkMm: { x: 0, y: 0, w, h: 2 + lines.length * 3.6 },
      maximumForms: [lines.join("\n")],
      wrapWidthMm: w - 2,
    });
  }
  if (!shapes.length)
    throw new NavigationSlotFailure("No complete port pointer entry fits", {
      widthMm: width,
      entryWidthsMm: tokens.map(
        (t) => printableTextMetrics(t, 2.5).advance + 2,
      ),
    });
  return {
    id,
    ownerAppearance: id,
    ownerOccurrence: id,
    profileId: "assembly-port-pointer/1",
    space: "sheet-slot",
    inkMm: required(shapes[0], "Connector pointer identity cannot fit").inkMm,
    maximumForms: [tokens.join(" ")],
    shapes,
  };
}
function pointerTokens(
  geometry: ReturnType<typeof assemblyPortGeometry>,
  part: ReturnType<typeof assemblyPortGeometry>["parts"][number],
  uid: string,
) {
  const local = new Set(part.ports.map((p) => p.id));
  const tokens: string[] = [];
  for (const port of geometry.inventory.ports) {
    const id = connectorPortKey(port.deviceUid, port.key),
      target = geometry.targets.get(id);
    if (port.deviceUid !== uid || local.has(id) || !target) continue;
    if (tokens.length) tokens[tokens.length - 1] += ";";
    tokens.push(
      `Port ${port.designation}.${port.key} → ${destinationToken(target)}`,
    );
  }
  if (tokens.length) tokens[tokens.length - 1] += ".";
  return tokens;
}
function pointerSlot(
  id: string,
  tokens: readonly string[],
  field: DrawingBounds,
  sheet: RenderedSheet,
  claims: readonly DrawingBounds[],
  dependencies: readonly DocumentDependency[],
) {
  let reservation: AnnotationReservation | undefined;
  try {
    reservation = pointerReservation(id, tokens, field.w);
    return required(
      allocateNavigationSlots(
        [{ reservation, owner: field }],
        field,
        sheet.svg,
        sheet.number,
        claims,
      )[0],
      "Missing assembly pointer allocation",
    );
  } catch (error) {
    if (!(error instanceof NavigationSlotFailure)) throw error;
    const needed = reservation?.inkMm ?? {
      x: 0,
      y: 0,
      w:
        Math.max(...tokens.map((t) => printableTextMetrics(t, 2.5).advance)) +
        2,
      h: 5.6,
    };
    throw new DocumentDependencyError(
      `Connector port pointers at sheet ${sheet.number} (${tokens.join(" ")}): require ${needed.w.toFixed(2)} × ${needed.h.toFixed(2)} mm; available ${field.w.toFixed(2)} × ${field.h.toFixed(2)} mm. ${error.message}`,
      dependencies.filter((d) => d.owner.sheet === sheet.number),
      {
        sheet: sheet.number,
        profile: "assembly-port-pointer/1",
        availableMm: field,
        requiredMm: needed,
        placementSearch: error.search,
        pointerEntries: tokens,
      },
    );
  }
}
/** Named per-port pointers to painted landings; these are never M3 inventories. */
export function assemblyPortPointers(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  page: PaperPage,
  dependencies: readonly DocumentDependency[],
) {
  const geometry = assemblyPortGeometry(ir, drafts, sheets, page);
  return sheets.map((sheet, i) => {
    const part = geometry.parts.find((p) => p.sheet === sheet.number);
    if (!part) return sheet;
    let svg = sheet.svg;
    const claims = dependencies
      .filter((d) => d.owner.sheet === sheet.number)
      .flatMap((d) => (d.caption ? [d.caption.rectMm] : []));
    const inline = drafts[i]?.inlineDocumentBounds;
    if (inline) claims.push(inline);
    for (const uid of part.devices) {
      if (!uid) continue;
      const tokens = pointerTokens(geometry, part, uid);
      if (!tokens.length) continue;
      const id = `assembly-port-pointers/${sheet.number}/${uid}`;
      const slot = pointerSlot(
        id,
        tokens,
        part.field,
        { ...sheet, svg },
        claims,
        dependencies,
      );
      const box = required(
        slot.allocatedMm,
        "Missing assembly pointer box",
      ).rect;
      claims.push(box);
      const value = required(
        slot.maximumForms[0],
        "Missing assembly pointer text",
      );
      const ink = value
        .split("\n")
        .map((s, n) => text(box.x + 1, box.y + 3 + n * 3.6, s, 2.5))
        .join("");
      svg = svg.replace(
        /<\/svg>(\s*)$/,
        `<g id="${attr(id)}" data-assembly-port-destinations="${attr(uid)}">${ink}</g></svg>$1`,
      );
    }
    return { ...sheet, svg };
  });
}
