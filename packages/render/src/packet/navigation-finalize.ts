import type { ElectricalIr, FunctionId } from "@thermite/compiler";
import { resolveReturnLocality } from "./return-locality.js";
import type { Draft, RenderedSheet, PaperPage } from "./types.js";
import type {
  IssuedNavigation,
  AnnotationReservation,
  NavigationAnnotation,
  PlacedOccurrence,
} from "./navigation-types.js";
import { placeOccurrences } from "./navigation-occurrences.js";
import {
  planRepeatNavigation,
  NAVIGATION_FONT_MM,
} from "./navigation-repeats.js";
import {
  allocateNavigationSlots,
  NavigationSlotFailure,
} from "./navigation-slots.js";
import { navigationDraftInputs } from "./navigation-seeds.js";
import { navigationSnapshotDigest } from "./navigation-identity.js";
import { text } from "./svg.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { printableTextMetrics } from "../text-metrics.js";
import { unionInk } from "./rooted-ink.js";
import { inside } from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";
import type { RenderOutcome } from "../types.js";
import { failure } from "./errors.js";
import type { SheetSlotRequest } from "./navigation-slots.js";
import type { RepeatPlan } from "./navigation-repeats.js";
import { repeatLocalityInk } from "./navigation-label-ink.js";
import { mirrorLocalityInk } from "./mirror-layout.js";
import { symbolGeometry, type SymbolGeometry } from "./navigation-symbols.js";
import { resolveLabelLocality } from "./navigation-locality.js";
import {
  wrapNavigationText,
  NAVIGATION_FONT_MM as MIRROR_EM,
} from "./navigation-labels.js";
import { planMirrors } from "./mirror-plan.js";
import {
  mirrorAnnotationSvg,
  resolveMirrorLocality,
  mirrorLocalBand,
} from "./mirror-ink.js";
import { placeContactNotice } from "./mirror-notice.js";
import { validateAppearanceIncidence } from "./navigation-incidence.js";
import { finalizeDocuments } from "./document-captions.js";
import { DocumentDependencyError } from "./document-error.js";

function annotationSvg(
  annotation: NavigationAnnotation,
  reservation: AnnotationReservation,
): string {
  if (
    ["mirror", "return", "association-unspecified", "contact-notice"].includes(
      annotation.role,
    )
  )
    return mirrorAnnotationSvg(annotation, reservation);
  const box = required(
    reservation.allocatedMm,
    "Unallocated navigation reservation",
  ).rect;
  const lines = annotation.text.split("\n");
  for (const [i, line] of lines.entries()) {
    const m = printableTextMetrics(line, NAVIGATION_FONT_MM);
    if (
      !inside(
        {
          x: box.x + 1 + m.left,
          y: box.y + 3.7 + i * 4.8 - m.top,
          w: m.right - m.left,
          h: m.top - m.bottom,
        },
        box,
      )
    )
      throw Error(`Navigation actual ink exceeds ${reservation.profileId}`);
  }
  return `<g id="${attr(required(annotation.primitiveIds[0], "Missing annotation primitive"))}" data-navigation-annotation="${attr(annotation.id)}" data-navigation-owner="${attr(annotation.ownerOccurrence)}" data-navigation-role="${annotation.role}">${lines.map((s, i) => text(box.x + 1, box.y + 3.7 + i * 4.8, s, NAVIGATION_FONT_MM)).join("")}</g>`;
}
function emitSheetNavigation(
  sheet: RenderedSheet,
  owners: readonly import("./navigation-types.js").PlacedOccurrence[],
  all: readonly NavigationAnnotation[],
  allocated: readonly AnnotationReservation[],
): RenderedSheet {
  const annotations = all.filter((a) =>
    owners.some((o) => o.id === a.ownerOccurrence),
  );
  const ink = annotations
    .map((a) =>
      annotationSvg(
        a,
        required(
          allocated.find((r) => r.id === a.reservationId),
          "Missing allocated annotation",
        ),
      ),
    )
    .join("");
  return {
    ...sheet,
    svg: sheet.svg.replace(
      /<\/svg>(\s*)$/,
      (_, tail: string) => `${ink}</svg>${tail}`,
    ),
    ...(owners.length ? { occurrenceIds: owners.map((o) => o.id) } : {}),
    ...(annotations.length
      ? { annotationIds: annotations.map((a) => a.id) }
      : {}),
  };
}

interface FinalizationOptions {
  notice?: boolean;
  page?: PaperPage;
  documents?: {
    presentation:
      import("@thermite/compiler").CompiledProjectPresentation | undefined;
    standalone: boolean;
  };
}

/** Pure finalization over immutable native drafts. Calling it twice produces the same bytes. */
export function finalizeNavigation(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  options: FinalizationOptions = {},
): RenderOutcome<{ sheets: RenderedSheet[]; navigation: IssuedNavigation }> & {
  failedSheet?: number;
} {
  try {
    return finalizeCheckedNavigation(ir, drafts, sheets, options);
  } catch (error) {
    return failure(
      "unprintable-layout",
      `Navigation invariant: ${error instanceof Error ? error.message : String(error)}`,
      {
        navigationInvariant: true,
        ...(error instanceof DocumentDependencyError ? error.details : {}),
      },
    );
  }
}
function finalizeCheckedNavigation(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  options: FinalizationOptions,
): ReturnType<typeof finalizeNavigation> {
  const whole = finalizeMirrorCandidate(ir, drafts, sheets, false, options);
  if (
    whole.ok ||
    ("details" in whole.error && whole.error.details?.navigationInvariant)
  )
    return whole;
  return finalizeMirrorCandidate(ir, drafts, sheets, true, options);
}
function finalizeMirrorCandidate(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  split: boolean,
  options: FinalizationOptions,
): ReturnType<typeof finalizeNavigation> {
  const occurrences = placeOccurrences(ir, drafts, sheets),
    maximums = selectedAppearanceMaximums(drafts),
    plan = planRepeatNavigation(
      ir,
      occurrences,
      maximums.counts,
      maximums.members,
    );
  const mirrors = planMirrors(ir, occurrences, sheets, maximums.counts, split);
  plan.annotations = [...mirrors.annotations, ...plan.annotations];
  plan.reservations = [...mirrors.reservations, ...plan.reservations];
  validateAppearanceIncidence(ir, occurrences, sheets);
  const reservations: AnnotationReservation[] = [];
  const result: RenderedSheet[] = [];
  for (const [i, sheet] of sheets.entries()) {
    const owners = occurrences.filter(
      (o) => o.destination.sheet === sheet.number,
    );
    const draft = required(drafts[i], "Missing navigation draft");
    const requests = sheetRequests(plan, owners, occurrences, sheet, draft);
    const allocation = allocateSheetRequests(
      requests,
      owners,
      sheet,
      draft,
      drafts.length,
      split,
    );
    if (!allocation.ok) return { ...allocation, failedSheet: i };
    const allocated = allocation.value;
    plan.annotations = resolveAnnotations(
      ir,
      plan.annotations,
      allocated,
      requests,
      owners,
      draft,
    );
    reservations.push(...allocated);
    result.push(
      emitSheetNavigation(sheet, owners, plan.annotations, allocated),
    );
  }
  if (options.notice !== false)
    placeContactNotice(
      plan.annotations,
      reservations,
      drafts,
      result,
      options.page,
    );
  if (new Set(reservations.map((r) => r.id)).size !== reservations.length)
    throw Error("Duplicate navigation reservation identity");
  const navigation = issuedNavigation(
    ir,
    drafts,
    occurrences,
    plan,
    reservations,
  );
  return documentExtension(ir, drafts, result, navigation, options);
}
function documentExtension(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: RenderedSheet[],
  navigation: IssuedNavigation,
  options: FinalizationOptions,
): ReturnType<typeof finalizeNavigation> {
  return {
    ok: true,
    value: options.documents
      ? finalizeDocuments(
          ir,
          drafts,
          sheets,
          required(options.page, "Missing document page"),
          navigation,
          options.documents.standalone,
          options.documents.presentation,
        )
      : { sheets, navigation },
  };
}

function resolveAnnotations(
  ir: Readonly<ElectricalIr>,
  annotations: readonly NavigationAnnotation[],
  allocated: readonly AnnotationReservation[],
  requests: readonly NavigationRequest[],
  owners: readonly PlacedOccurrence[],
  draft: Draft,
): NavigationAnnotation[] {
  return annotations.map((a) => {
    const slot = allocated.find((r) => r.id === a.reservationId);
    if (!slot) return a;
    const request = required(
      requests.find((r) => r.reservation.id === slot.id),
      "Missing navigation request",
    );
    const owner = required(
      owners.find((o) => o.id === a.ownerOccurrence),
      "Missing label owner",
    );
    if (a.role === "mirror")
      return resolveMirrorLocality(
        ir,
        a,
        slot,
        request.localityGeometry,
        required(draft.drawingBounds, "Missing mirror field"),
      );
    if (a.role === "contact-notice")
      return {
        ...a,
        text: wrapNavigationText(
          a.text,
          ((slot.inkMm.w - 2) * MIRROR_EM) / 2.7,
        ),
      };
    if (a.role === "return") return resolveReturnLocality(a, slot, owners);
    if (a.role === "association-unspecified") return a;
    return resolveLabelLocality(
      ir,
      a,
      slot,
      request.localityGeometry,
      owner.source.deviceUid,
    );
  });
}
type NavigationRequest = SheetSlotRequest & {
  localityGeometry: SymbolGeometry;
};
function sheetRequests(
  plan: RepeatPlan,
  owners: readonly PlacedOccurrence[],
  occurrences: readonly PlacedOccurrence[],
  sheet: RenderedSheet,
  draft: Draft,
): NavigationRequest[] {
  return plan.reservations.flatMap((reservation) => {
    const owner = owners.find(
      (o) => o.id === reservation.ownerOccurrence && o.role === "full-function",
    );
    if (!owner) return [];
    const annotation = required(
      plan.annotations.find((a) => a.reservationId === reservation.id),
      "Missing navigation annotation",
    );
    const mirrorService = [
      "mirror",
      "return",
      "association-unspecified",
    ].includes(annotation.role);
    const locality = symbolGeometry(
      owner,
      mirrorService || annotation.role === "element-location"
        ? occurrences.filter((o) => annotation.ownerOccurrences.includes(o.id))
        : occurrences,
      sheet.svg,
      required(draft.drawingBounds, "Missing navigation field"),
      occurrences,
    );
    if (annotation.role === "element-location")
      locality.sourceAnchorsMm = occurrences
        .filter((o) => annotation.ownerOccurrences.includes(o.id))
        .map((o) => o.destination.anchorMm);
    if (annotation.role === "return" && annotation.ownerOccurrences.length > 1)
      locality.frameMm = required(
        unionInk(
          occurrences
            .filter((o) => annotation.ownerOccurrences.includes(o.id))
            .map(
              (o) =>
                symbolGeometry(
                  o,
                  [o],
                  sheet.svg,
                  required(draft.drawingBounds, "Missing gang field"),
                ).frameMm,
            ),
        ),
        "Missing gang frames",
      );
    if (mirrorService) {
      locality.anchorMm = owner.destination.anchorMm;
      locality.ownerLocation = {
        sheet: owner.destination.sheet,
        zone: owner.destination.zone,
      };
    }
    if (annotation.role === "mirror")
      locality.localBandMm = mirrorLocalBand(
        locality,
        required(draft.drawingBounds, "Missing mirror field"),
      );
    return [
      navigationRequest(reservation, annotation, locality, mirrorService),
    ];
  });
}
function navigationRequest(
  reservation: AnnotationReservation,
  annotation: NavigationAnnotation,
  locality: SymbolGeometry,
  mirrorService: boolean,
): NavigationRequest {
  return {
    reservation,
    owner: locality.frameMm,
    ...(!mirrorService || annotation.role === "mirror" ? { locality } : {}),
    preferBesideBelow: annotation.role === "mirror",
    localityGeometry: locality,
    fitPrintedInk: annotation.role === "element-location",
    localityInkMm:
      annotation.role === "mirror"
        ? mirrorLocalityInk(annotation, reservation)
        : repeatLocalityInk(annotation, reservation),
  };
}
function allocateSheetRequests(
  requests: readonly NavigationRequest[],
  owners: readonly PlacedOccurrence[],
  sheet: RenderedSheet,
  draft: Draft,
  pageCount: number,
  split: boolean,
): RenderOutcome<AnnotationReservation[]> {
  try {
    const allocated = requests.length
      ? allocateNavigationSlots(
          requests,
          required(draft.drawingBounds, "Missing navigation field"),
          sheet.svg,
          sheet.number,
        )
      : [];
    return { ok: true, value: allocated };
  } catch (error) {
    const failed = failure(
      "unprintable-layout",
      error instanceof Error ? error.message : "Navigation slot unavailable",
      {
        ...(error instanceof NavigationSlotFailure
          ? { placementSearch: error.search }
          : {}),
        sheet: sheet.number,
        mirrorForm: split ? "four-row-fragments" : "whole",
        profiles: requests.map((r) => r.reservation.profileId),
        requiredMm: requests.map((r) => r.reservation.inkMm),
        actualScaleMmPerUnit: owners.map((o) =>
          Math.hypot(o.provenance.transform[0], o.provenance.transform[1]),
        ),
        minimumScale: "not applicable to fixed sheet slots",
        availableMm: draft.drawingBounds,
        nativeRootedPages: draft.rootedFit?.basePages ?? null,
        candidatePacketPages: pageCount,
        sources: owners.map((o) => o.source),
      },
    );
    return failed;
  }
}
function selectedAppearanceMaximums(drafts: readonly Draft[]) {
  const members = new Map<string, Map<string, FunctionId>>();
  const groups = new Map<string, Set<string>>();
  for (const input of navigationDraftInputs(drafts))
    for (const s of input.seeds) {
      if (["terminal", "boundary"].includes(s.representation)) continue;
      const key = JSON.stringify([s.source.deviceUid, s.source.functionKey]);
      const appearances = groups.get(key) ?? new Set<string>();
      appearances.add(JSON.stringify([input.view.key, s.logicalKey]));
      groups.set(key, appearances);
      const appearance = JSON.stringify([s.source.deviceUid, input.view.key]);
      const sources = members.get(appearance) ?? new Map<string, FunctionId>();
      sources.set(JSON.stringify([s.source, s.logicalKey]), s.source);
      members.set(appearance, sources);
    }
  return {
    counts: new Map([...groups].map(([k, v]) => [k, v.size])),
    members: new Map([...members].map(([k, v]) => [k, [...v.values()]])),
  };
}
function issuedNavigation(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  occurrences: import("./navigation-types.js").PlacedOccurrence[],
  plan: import("./navigation-repeats.js").RepeatPlan,
  reservations: AnnotationReservation[],
): IssuedNavigation {
  return {
    format: "issued-navigation/0.1",
    snapshotDigest: navigationSnapshotDigest(ir),
    anchorRule: "function-terminal-centroid/2",
    quantumMm: 0.01,
    rounding: "decimal-half-up/1",
    seeds: exportedSeeds(drafts),
    measurementGaps: [
      ...new Map(
        navigationDraftInputs(drafts).flatMap((input) =>
          input.seeds
            .filter((s) =>
              ir.functions.some(
                (f) =>
                  f.id.deviceUid === s.source.deviceUid &&
                  f.id.functionKey === s.source.functionKey &&
                  !f.terminals.length,
              ),
            )
            .map((s) => {
              const appearance = JSON.stringify([input.view.key, s.logicalKey]);
              return [
                JSON.stringify([s.source, appearance]),
                {
                  source: s.source,
                  appearance,
                  reason:
                    "terminal-free function has no catalog body anchor" as const,
                },
              ] as const;
            }),
        ),
      ).values(),
    ],
    pageRegions: [
      ...occurrences.map((o) => ({
        sheet: o.destination.sheet,
        ownerId: o.id,
        kind: "occurrence" as const,
        basis:
          o.representation === "circuit"
            ? ("adapter-box" as const)
            : ("catalog-box" as const),
        rectMm: o.provenance.bodyMm,
      })),
      ...reservations.map((r) => ({
        sheet: required(r.allocatedMm, "Missing allocated region").sheet,
        ownerId: r.id,
        kind: "annotation" as const,
        basis: "reservation-box" as const,
        rectMm: required(r.allocatedMm, "Missing allocated region").rect,
      })),
    ],
    occurrences,
    canonicalGroups: plan.groups,
    reservations,
    annotations: plan.annotations,
  };
}
function exportedSeeds(drafts: readonly Draft[]): IssuedNavigation["seeds"] {
  return [
    ...new Map(
      navigationDraftInputs(drafts).flatMap((input) =>
        input.seeds.map((s) => {
          const appearance = JSON.stringify([input.view.key, s.logicalKey]);
          return [
            JSON.stringify([s.source, appearance]),
            {
              source: s.source,
              appearance,
              representation: s.representation,
              terminalKeys: [...new Set(s.terminals.map((t) => t.key))],
            },
          ] as const;
        }),
      ),
    ).values(),
  ];
}
