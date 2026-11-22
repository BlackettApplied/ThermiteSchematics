import type { DocumentDependency, IssuedDocument } from "./document-types.js";
import type { RenderedSheet } from "./types.js";
import type { Rect } from "../device-legend/geometry.js";
import type {
  AnnotationReservation,
  NavigationShape,
} from "./navigation-types.js";
import { portCaptionPack } from "./document-port-caption-pack.js";
import {
  allocateNavigationSlots,
  NavigationSlotFailure,
} from "./navigation-slots.js";
import { navigationHash } from "./navigation-identity.js";
import { required } from "../presentation/util.js";
import { text } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

/** Packed omitted-port captions; drawn ports use their separate native pointers. */
export function packedPortCaptions(
  needs: readonly DocumentDependency[],
  documents: readonly IssuedDocument[],
  field: Rect,
  sheet: RenderedSheet,
  claims: readonly Rect[],
) {
  if (!needs.length) return undefined;
  const plans = [
    ...new Set([field.w, Math.min(160, field.w), Math.min(100, field.w)]),
  ].flatMap((w) => {
    const plan = portCaptionPack(needs, documents, w);
    return plan ? [plan] : [];
  });
  if (!plans.length) return undefined;
  const shapes: NavigationShape[] = plans.map((p, i) => ({
    id: String(i),
    mode: "self-located",
    inkMm: { x: 0, y: 0, w: p.width, h: p.height },
    maximumForms: [p.entries.map((e) => e.lines.join("\n")).join("\n")],
    wrapWidthMm: p.width - 2,
  }));
  const id = `assembly-port-captions/${navigationHash(needs.map((n) => n.id))}`;
  const reservation: AnnotationReservation = {
    id,
    ownerAppearance: required(needs[0], "Missing port need").owner.viewKey,
    ownerOccurrence: id,
    profileId: "assembly-port-captions/1",
    space: "sheet-slot",
    inkMm: required(shapes[0], "Missing packed caption shape").inkMm,
    maximumForms: [],
    shapes,
  };
  try {
    const slot = required(
      allocateNavigationSlots(
        [{ reservation, owner: field }],
        field,
        sheet.svg,
        sheet.number,
        claims,
      )[0],
      "Missing packed caption slot",
    );
    const allocation = required(
      slot.allocatedMm,
      "Missing packed caption allocation",
    );
    const plan = required(
      plans[Number(allocation.shapeId)],
      "Missing packed caption plan",
    );
    const svg = packedInk(plan, allocation.rect);
    return { svg, rect: allocation.rect };
  } catch (error) {
    if (error instanceof NavigationSlotFailure) return undefined;
    throw error;
  }
}

function packedInk(
  plan: NonNullable<ReturnType<typeof portCaptionPack>>,
  box: Rect,
) {
  return plan.entries
    .map(({ need, lines, x, y }) => {
      const primitiveId = `${need.id}/ink`;
      need.caption = {
        primitiveId,
        text: lines.join("\n"),
        rectMm: box,
        form: "identities",
      };
      const ink = lines
        .map((s, i) => text(box.x + x + 1, box.y + y + 3 + i * 3.6, s, 2.5))
        .join("");
      return `<g id="${attr(primitiveId)}" data-document-dependency="${attr(need.id)}" data-document-caption-form="identities" data-document-note-id="${attr(need.noteId)}">${ink}</g>`;
    })
    .join("");
}
