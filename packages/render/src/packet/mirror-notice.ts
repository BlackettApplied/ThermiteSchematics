import type { Draft, PaperPage, RenderedSheet } from "./types.js";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "./navigation-types.js";
import { CONTACT_TABLE_NOTICE } from "../off-view/notice.js";
import { wrapNavigationText } from "./navigation-labels.js";
import { navigationHash } from "./navigation-identity.js";
import { allocateNavigationSlots } from "./navigation-slots.js";
import { mirrorAnnotationSvg } from "./mirror-ink.js";
import { bounds } from "./page.js";
import { required } from "../presentation/util.js";

/** Packet-level note: cannot trigger composition, pagination or scale selection. */
export function placeContactNotice(
  annotations: NavigationAnnotation[],
  reservations: AnnotationReservation[],
  drafts: readonly Draft[],
  sheets: RenderedSheet[],
  page?: PaperPage,
) {
  const owner = annotations.find(
    (a) =>
      a.role === "mirror" ||
      a.role === "return" ||
      a.role === "association-unspecified",
  );
  if (!owner) return;
  const reservation = noticeReservation(
    owner,
    required(
      reservations.find((r) => r.id === owner.reservationId),
      "Missing notice source reservation",
    ).ownerAppearance,
  );
  const ordered = noticeSheets(sheets, drafts);
  for (const { sheet, i } of ordered) {
    const draft = required(drafts[i], "Missing notice draft");
    const field =
      draft.drawingBounds ?? (page ? bounds(draft.title, page) : undefined);
    if (!field) continue;
    let slot: AnnotationReservation | undefined;
    try {
      slot = allocateNavigationSlots(
        [{ reservation, owner: field }],
        field,
        sheet.svg,
        sheet.number,
        protectedNoticeBoxes(reservations, sheet.number),
      )[0];
    } catch {
      continue;
    }
    if (!slot) continue;
    const annotation: NavigationAnnotation = {
      id: reservation.id,
      ownerOccurrence: owner.ownerOccurrence,
      ownerOccurrences: [owner.ownerOccurrence],
      role: "contact-notice",
      targets: [],
      text: required(slot.maximumForms[0], "Missing notice text"),
      primitiveIds: [`${reservation.id}/ink`],
      reservationId: reservation.id,
    };
    const ink = mirrorAnnotationSvg(annotation, slot);
    sheets[i] = {
      ...sheet,
      svg: sheet.svg.replace(
        /<\/svg>(\s*)$/,
        (_, tail: string) => `${ink}</svg>${tail}`,
      ),
      annotationIds: [...(sheet.annotationIds ?? []), annotation.id],
    };
    annotations.push(annotation);
    reservations.push(slot);
    return;
  }
  throw Error(
    "Contact notice has no measured vacancy on any existing packet drawing or documentation sheet",
  );
}
function protectedNoticeBoxes(
  reservations: readonly AnnotationReservation[],
  sheet: number,
) {
  return reservations
    .filter((r) => r.allocatedMm?.sheet === sheet)
    .map(
      (r) => required(r.allocatedMm, "Missing protected navigation box").rect,
    );
}
function noticeSheets(
  sheets: readonly RenderedSheet[],
  drafts: readonly Draft[],
) {
  return sheets
    .map((sheet, i) => ({
      sheet,
      i,
      priority: noticePriority(
        sheet,
        required(drafts[i], "Missing notice draft"),
      ),
    }))
    .sort((a, b) => a.priority - b.priority || a.sheet.number - b.sheet.number);
}
function noticePriority(sheet: RenderedSheet, draft: Draft) {
  if (draft.documentationTable) return 3;
  if (sheet.svg.includes('data-navigation-role="mirror"')) return 0;
  return sheet.svg.includes('data-selected-view-notice="true"') ? 1 : 2;
}
function noticeReservation(
  owner: NavigationAnnotation,
  ownerAppearance: string,
): AnnotationReservation {
  const id = `contact-notice/2/${navigationHash(owner.ownerOccurrence)}`;
  const shapes = [150, 100, 55, 35].map((w) => {
    const printed = wrapNavigationText(
      CONTACT_TABLE_NOTICE,
      ((w - 2) * 3.502) / 2.7,
    );
    return {
      id: `notice/${w}`,
      mode: "self-located" as const,
      inkMm: { x: 0, y: 0, w, h: 1.5 + 4.5 * printed.split("\n").length },
      maximumForms: [printed],
      wrapWidthMm: w - 2,
    };
  });
  return {
    id,
    ownerOccurrence: owner.ownerOccurrence,
    ownerAppearance,
    profileId: "contact-notice/2",
    space: "sheet-slot",
    inkMm: required(shapes[0], "Missing notice shape").inkMm,
    maximumForms: [CONTACT_TABLE_NOTICE],
    shapes,
  };
}
