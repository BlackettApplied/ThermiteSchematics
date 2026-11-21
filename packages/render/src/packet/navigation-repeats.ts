import type { ElectricalIr, FunctionId } from "@thermite/compiler";
import type {
  AnnotationReservation,
  PlacedOccurrence,
  NavigationAnnotation,
  IssuedNavigation,
} from "./navigation-types.js";
import { planElementNavigation } from "./navigation-elements.js";
import { navigationHash } from "./navigation-identity.js";
import { compareText } from "../ordering.js";
import { required } from "../presentation/util.js";
import {
  distinctDestinations,
  labelLines,
  maximumRepeatForms,
  maximumToken,
  repeatNoun,
} from "./navigation-labels.js";
export { NAVIGATION_FONT_MM } from "./navigation-labels.js";
export interface RepeatPlan {
  groups: IssuedNavigation["canonicalGroups"];
  reservations: AnnotationReservation[];
  annotations: NavigationAnnotation[];
}
const readingOrder = (a: PlacedOccurrence, b: PlacedOccurrence) =>
  a.provenance.view.authoredOrder - b.provenance.view.authoredOrder ||
  a.destination.sheet - b.destination.sheet ||
  compareText(a.destination.zone, b.destination.zone) ||
  a.destination.anchorMm.y - b.destination.anchorMm.y ||
  a.destination.anchorMm.x - b.destination.anchorMm.x ||
  compareText(a.appearance, b.appearance);
interface LabelMember {
  owner: PlacedOccurrence;
  canonical: PlacedOccurrence;
  targets: PlacedOccurrence[];
}
export function planRepeatNavigation(
  ir: Readonly<ElectricalIr>,
  occurrences: readonly PlacedOccurrence[],
  maximumCounts: ReadonlyMap<string, number> = new Map(),
  maximumMembers: ReadonlyMap<string, readonly FunctionId[]> = new Map(),
): RepeatPlan {
  const byFunction = new Map<string, PlacedOccurrence[]>();
  for (const o of occurrences)
    if (o.role === "full-function") {
      const key = JSON.stringify([o.source.deviceUid, o.source.functionKey]);
      byFunction.set(key, [...(byFunction.get(key) ?? []), o]);
    }
  const capacities = new Map(
    [...byFunction].map(
      ([key, appearances]) => [key, appearances.length] as const,
    ),
  );
  for (const [key, count] of maximumCounts) capacities.set(key, count);
  const groups: RepeatPlan["groups"][number][] = [],
    labels = new Map<string, LabelMember[]>();
  for (const appearances of byFunction.values()) {
    if (appearances.length < 2) continue;
    const sorted = appearances.slice().sort(readingOrder),
      canonical = required(sorted[0], "Missing canonical occurrence");
    groups.push({
      source: canonical.source,
      canonical: canonical.id,
      occurrences: sorted.map((o) => o.id),
    });
    for (const owner of sorted) {
      const symbol = JSON.stringify([
        owner.source.deviceUid,
        owner.destination.sheet,
        owner.provenance.view.key,
      ]);
      labels.set(symbol, [
        ...(labels.get(symbol) ?? []),
        {
          owner,
          canonical,
          targets: owner === canonical ? sorted.slice(1) : [canonical],
        },
      ]);
    }
  }
  const planned = [...labels.values()].map((members) =>
    groupedLabel(ir, members, capacities, maximumMembers),
  );
  const elements = planElementNavigation(ir, occurrences);
  return {
    groups,
    reservations: [
      ...planned.map((p) => p.reservation),
      ...elements.reservations,
    ],
    annotations: [...planned.map((p) => p.annotation), ...elements.annotations],
  };
}
function groupedLabel(
  ir: Readonly<ElectricalIr>,
  members: LabelMember[],
  maximumCounts: ReadonlyMap<string, number>,
  maximumMembers: ReadonlyMap<string, readonly FunctionId[]>,
) {
  members.sort((a, b) =>
    compareText(a.owner.source.functionKey, b.owner.source.functionKey),
  );
  const owner = required(members[0], "Missing symbol owner").owner;
  const tag = required(
    ir.devices.find((d) => d.uid === owner.source.deviceUid),
    "Missing repeat device",
  ).designation;
  const profile = maximumProfile(
    ir,
    owner,
    members,
    maximumCounts,
    maximumMembers,
  );
  const { also, repeats, lines } = groupedText(ir, members, tag);
  const token = maximumToken();
  const maximum = maximumRepeatForms(tag, profile.noun, profile.counts, token);
  const owners = members.map((m) => m.owner.id);
  const id = `navigation/2/${navigationHash(owners)}`;
  const reservation: AnnotationReservation = {
    id,
    ownerAppearance: owner.appearance,
    ownerOccurrence: owner.id,
    profileId: `repeat-max-roles/2/${profile.count}/${profile.counts.length}`,
    space: "sheet-slot",
    inkMm: { x: 0, y: 0, w: maximum.w, h: maximum.h },
    maximumForms: maximum.forms,
    shapes: maximum.shapes,
  };
  const annotation: NavigationAnnotation = {
    id,
    ownerOccurrence: owner.id,
    ownerOccurrences: owners,
    role:
      also.length && repeats.length
        ? "mixed"
        : also.length
          ? "canonical"
          : "repeat",
    targets: [...new Set(members.flatMap((m) => m.targets.map((o) => o.id)))],
    text: lines.join("\n"),
    primitiveIds: [`${id}/ink`],
    reservationId: id,
  };
  return { reservation, annotation };
}

function groupedText(
  ir: Readonly<ElectricalIr>,
  members: readonly LabelMember[],
  tag: string,
) {
  const also = members
    .filter((m) => m.owner === m.canonical)
    .flatMap((m) => m.targets);
  const repeats = members
    .filter((m) => m.owner !== m.canonical)
    .flatMap((m) => m.targets);
  const prefix = `${tag}: `,
    lines: string[] = [];
  if (also.length)
    lines.push(
      labelLines(prefix, "Also shown", distinctDestinations(also)).join(" "),
    );
  if (repeats.length)
    lines.push(
      labelLines(
        also.length ? "" : prefix,
        "Repeat of",
        distinctDestinations(repeats),
        ` (same ${repeatNoun(
          ir,
          members.filter((m) => m.owner !== m.canonical).map((m) => m.owner),
        )})`,
      ).join(" "),
    );
  return { also, repeats, lines };
}

/** Native pre-pagination candidates fix capacity even when final membership changes. */
function maximumProfile(
  ir: Readonly<ElectricalIr>,
  owner: PlacedOccurrence,
  members: readonly LabelMember[],
  counts: ReadonlyMap<string, number>,
  candidates: ReadonlyMap<string, readonly FunctionId[]>,
) {
  const key = JSON.stringify([
    owner.source.deviceUid,
    owner.provenance.view.key,
  ]);
  const multiplicity = (source: FunctionId) =>
    required(
      counts.get(JSON.stringify([source.deviceUid, source.functionKey])),
      "Missing repeat capacity source",
    );
  const selected = (
    candidates.get(key) ?? members.map((m) => m.owner.source)
  ).filter((source) => multiplicity(source) > 1);
  const multiplicities = selected.map(multiplicity);
  const owners = selected.map((source) => ({ ...owner, source }));
  return {
    noun: repeatNoun(ir, owners),
    counts: multiplicities,
    count: multiplicities.reduce((n, c) => n + c - 1, 0),
  };
}
