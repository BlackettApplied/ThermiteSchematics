import type { DocumentDependency } from "./document-types.js";
import type { AnnotationReservation } from "./navigation-types.js";
import { printableTextMetrics } from "../text-metrics.js";
import { wrapDocumentTokens } from "./document-caption-text.js";
import { inside } from "../device-legend/geometry.js";
import { text, n } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { required } from "../presentation/util.js";
import { DocumentDependencyError } from "./document-error.js";
import { maximumToken } from "./navigation-labels.js";
import { anchorDistance } from "./navigation-symbols.js";
import type { DocumentCaptionOwner } from "./document-caption-owner.js";
import type { DocumentCaptionLeader } from "./document-caption-leader.js";
import { unionInk } from "./rooted-ink.js";
import { navigationPlacementInk } from "./navigation-placement.js";
export interface DocumentCaptionSlot extends AnnotationReservation {
  captionOwner?: DocumentCaptionOwner;
  leader?: DocumentCaptionLeader;
}
export function documentCaptionTextInk(value: string) {
  return required(
    unionInk(
      value.split("\n").map((line, index) => {
        const m = printableTextMetrics(line, 2.5);
        return {
          x: 1 + m.left,
          y: 3 + index * 3.6 - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        };
      }),
    ),
    "Missing document caption ink",
  );
}
export function documentCaptionReservation(
  need: DocumentDependency,
  tokens: readonly string[],
  width: number,
): AnnotationReservation {
  const widths = [
    ...new Set([width, Math.min(120, width), Math.min(80, width)]),
  ];
  const shapes = widths.flatMap((w, i) => {
    if (
      tokens.some((token) => printableTextMetrics(token, 2.5).advance > w - 2)
    )
      return [];
    const lines = wrapDocumentTokens(tokens, w - 2);
    const maximum = wrapDocumentTokens(
      tokens.map((token) =>
        /^\d{2,3}\.[A-D][1-6]$/.test(token) ? maximumToken() : token,
      ),
      w - 2,
    );
    return [
      {
        id: `document-caption/${i}`,
        mode: "local" as const,
        inkMm: {
          x: 0,
          y: 0,
          w,
          h: 2 + Math.max(lines.length, maximum.length) * 3.6,
        },
        maximumForms: [lines.join("\n"), maximum.join("\n")],
        wrapWidthMm: w - 2,
      },
    ];
  });
  if (!shapes.length)
    throw new DocumentDependencyError(
      `Indivisible companion identity cannot fit ${width} mm at sheet ${need.owner.sheet} (${need.subject})`,
      [need],
      {
        sheet: need.owner.sheet,
        availableWidthMm: width,
        profile: "document-caption/1",
      },
    );
  return {
    id: `${need.id}/caption`,
    ownerAppearance: need.owner.viewKey,
    ownerOccurrence: need.owner.noteId,
    profileId: "document-caption/1",
    space: "sheet-slot",
    inkMm: required(shapes[0], "Missing caption shape").inkMm,
    maximumForms: [tokens.join(" ")],
    shapes,
  };
}
export function documentCaptionInk(
  need: DocumentDependency,
  slot: DocumentCaptionSlot,
  metadata: Pick<
    NonNullable<DocumentDependency["caption"]>,
    "form" | "groups"
  > = { form: "identities" },
): string {
  const box = required(slot.allocatedMm, "Missing document caption slot").rect,
    primitiveId = `${need.id}/ink`,
    value = required(slot.maximumForms[0], "Missing caption text");
  need.caption = { text: value, primitiveId, rectMm: box, ...metadata };
  if (slot.captionOwner) {
    const { deviceUid, terminalKey, anchorMm, ownerLocation } =
      slot.captionOwner;
    need.caption.locality = {
      deviceUid,
      ...(terminalKey === undefined ? {} : { terminalKey }),
      anchorMm,
      ownerLocation,
      mode: slot.allocatedMm?.placement ?? "self-located",
      distanceMm: anchorDistance(
        anchorMm,
        navigationPlacementInk(box, documentCaptionTextInk(value)),
      ),
      ...(slot.leader ? { leader: slot.leader } : {}),
    };
  }
  const lines = value.split("\n");
  for (const [n, line] of lines.entries()) {
    const m = printableTextMetrics(line, 2.5);
    if (
      !inside(
        {
          x: box.x + 1 + m.left,
          y: box.y + 3 + n * 3.6 - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        },
        box,
      )
    )
      throw new DocumentDependencyError(
        "Companion caption ink exceeds its reservation",
        [need],
        { allocatedMm: box },
      );
  }
  const leader = slot.leader;
  const support = leader
    ? `<path data-document-caption-leader="${attr(need.id)}" d="M ${n(leader.from.x)} ${n(leader.from.y)} L ${n(leader.to.x)} ${n(leader.to.y)}" fill="none" stroke="#667085" stroke-width="0.18" stroke-dasharray="1 1"/>`
    : "";
  return `<g id="${attr(primitiveId)}" data-document-dependency="${attr(need.id)}" data-document-caption-form="${metadata.form ?? "identities"}" data-document-note-id="${attr(need.owner.noteId)}">${support}${lines.map((line, n) => text(box.x + 1, box.y + 3 + n * 3.6, line, 2.5)).join("")}</g>`;
}
