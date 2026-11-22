import type { ElectricalIr } from "@thermite/compiler";
import { formatTerminalSet } from "@thermite/query";
import type {
  AnnotationReservation,
  NavigationAnnotation,
  PlacedOccurrence,
  MirrorRow,
} from "./navigation-types.js";
import type { RenderedSheet } from "./types.js";
import { navigationHash } from "./navigation-identity.js";
import {
  maximumToken,
  measureNavigationText,
  distinctDestinations,
  wrapNavigationText,
} from "./navigation-labels.js";
import {
  contactCoils,
  coilRelations,
  fullTargets,
  mirrorRows,
  mirrorTag,
  sameFunction,
  unspecifiedContact,
} from "./mirror-facts.js";
import { required } from "../presentation/util.js";
import { navigationGeometry } from "./navigation-walk.js";
export const MIRROR_ROW_MM = 3.502;
export const MIRROR_HEADING_MM = 3.782;
export interface MirrorPlan {
  annotations: NavigationAnnotation[];
  reservations: AnnotationReservation[];
}

export function planMirrors(
  ir: Readonly<ElectricalIr>,
  all: readonly PlacedOccurrence[],
  sheets: readonly RenderedSheet[],
  counts: ReadonlyMap<string, number>,
  split: boolean,
): MirrorPlan {
  const plan: MirrorPlan = { annotations: [], reservations: [] };
  for (const owner of all.filter((o) => o.role === "full-function")) {
    const fn = ir.functions.find((f) => sameFunction(f.id, owner.source));
    if (
      fn?.kind === "coil" &&
      ir.functions.some(
        (f) =>
          f.kind === "contact" && f.id.deviceUid === owner.source.deviceUid,
      )
    )
      addMirror(plan, ir, owner, all, counts, split);
  }
  addContacts(plan, ir, all, sheets, counts);
  return plan;
}
function addContacts(
  plan: MirrorPlan,
  ir: Readonly<ElectricalIr>,
  all: readonly PlacedOccurrence[],
  sheets: readonly RenderedSheet[],
  counts: ReadonlyMap<string, number>,
) {
  const covered = new Set<string>();
  for (const owner of all.filter((o) => o.role === "full-function")) {
    const fn = ir.functions.find((f) => sameFunction(f.id, owner.source));
    if (fn?.kind !== "contact" || covered.has(owner.id)) continue;
    const coils = contactCoils(ir, owner.source);
    if (!coils.length) {
      if (unspecifiedContact(ir, owner.source))
        addCaption(
          plan,
          owner,
          [owner],
          "Actuating coil not specified in device data",
          [],
          "association-unspecified",
        );
      continue;
    }
    const members = gangMembers(ir, owner, all, sheets);
    for (const m of members) covered.add(m.id);
    const targets = coils.flatMap((c) => fullTargets(c, all));
    const caption = coils
      .map((c) => {
        const destinations = distinctDestinations(fullTargets(c, all));
        return `${mirrorTag(ir, c)} ${destinations.length ? destinations.map((d) => `/${d}`).join(", ") : "not drawn"}`;
      })
      .join("; ");
    const maximum = coils
      .map(
        (c) =>
          `${mirrorTag(ir, c)} ${Array.from({ length: Math.max(1, counts.get(JSON.stringify([c.deviceUid, c.functionKey])) ?? 0) }, () => `/${maximumToken()}`).join(", ")}`,
      )
      .join("; ");
    addCaption(
      plan,
      owner,
      members,
      caption,
      targets.map((o) => o.id),
      "return",
      maximum,
    );
    required(plan.annotations.at(-1), "Missing contact return").sourceOrigins =
      coilRelations(ir)
        .filter((r) => members.some((m) => sameFunction(m.source, r.to)))
        .flatMap((r) => r.sourceOrigins);
    const gang = ir.gangedGroups.find(
      (g) =>
        members.length > 1 &&
        members.every((m) =>
          g.functionIds.some((f) => sameFunction(f, m.source)),
        ),
    );
    if (gang)
      required(plan.annotations.at(-1), "Missing gang return").gangId = gang.id;
  }
}
function addMirror(
  plan: MirrorPlan,
  ir: Readonly<ElectricalIr>,
  owner: PlacedOccurrence,
  all: readonly PlacedOccurrence[],
  counts: ReadonlyMap<string, number>,
  split: boolean,
) {
  const baseId = `mirror/1/${navigationHash(owner.id)}`,
    rows = mirrorRows(ir, owner.source, all, baseId),
    tag = mirrorTag(ir, owner.source);
  const chunks =
    split && rows.length > 4
      ? Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) =>
          rows.slice(i * 4, i * 4 + 4),
        )
      : [rows];
  for (const [part, chunk] of chunks.entries()) {
    const id = `${baseId}/${part}`,
      heading = `${tag}${chunks.length > 1 ? ` (${part + 1}/${chunks.length})` : ""}`;
    const { inkMm, maximumForms } = mirrorProfile(chunk, heading, counts);
    plan.reservations.push({
      id,
      ownerAppearance: owner.appearance,
      ownerOccurrence: owner.id,
      profileId: `mirror-compact-55/1/${chunk.length}`,
      space: "sheet-slot",
      inkMm,
      maximumForms,
    });
    plan.annotations.push({
      id,
      ownerOccurrence: owner.id,
      ownerOccurrences: [owner.id],
      role: "mirror",
      targets: chunk.flatMap((r) => r.targets),
      text: heading,
      mirror: {
        coil: owner.source,
        rows: chunk,
        heading,
        ...(chunks.length > 1 ? { part: part + 1, parts: chunks.length } : {}),
      },
      primitiveIds: [`${id}/ink`, ...chunk.map((r) => r.primitiveId)],
      reservationId: id,
    });
  }
}
function mirrorProfile(
  chunk: readonly MirrorRow[],
  heading: string,
  counts: ReadonlyMap<string, number>,
) {
  const terminalsWidth = Math.max(
    23.5,
    ...chunk.map(
      (r) => measureNavigationText(formatTerminalSet(r.terminals)) + 2,
    ),
  );
  const destinationWidth = Math.max(
    18.5,
    measureNavigationText("not drawn") + 1,
  );
  const w = Math.max(
    55,
    10 + terminalsWidth + destinationWidth + 1.5,
    (measureNavigationText(`${heading} /${maximumToken()}`) *
      MIRROR_HEADING_MM) /
      MIRROR_ROW_MM +
      3,
  );
  const forms = chunk.map((r) => {
    const n =
      counts.get(JSON.stringify([r.source.deviceUid, r.source.functionKey])) ??
      r.targets.length;
    return n
      ? Array.from({ length: n }, () => maximumToken()).join("\n")
      : "not drawn";
  });
  const lines = chunk.length
    ? forms.reduce((n, s) => n + s.split("\n").length, 0)
    : wrapNavigationText("Contact associations unspecified", w - 3).split("\n")
        .length;
  const inkMm = { x: 0, y: 0, w, h: 7 + 4.5 * lines };
  const maximumForms = [`${heading} /${maximumToken()}`, ...forms];
  return { inkMm, maximumForms };
}
function addCaption(
  plan: MirrorPlan,
  owner: PlacedOccurrence,
  members: readonly PlacedOccurrence[],
  value: string,
  targets: string[],
  role: "return" | "association-unspecified",
  maximum = value,
) {
  const id = `${role}/1/${navigationHash(members.map((m) => m.id))}`;
  const lines = role === "return" ? value : wrapNavigationText(value, 52);
  const inkMm = {
    x: 0,
    y: 0,
    w:
      role === "return"
        ? Math.max(
            measureNavigationText(value),
            measureNavigationText(maximum),
          ) + 3
        : 55,
    h: 1.5 + 4.5 * lines.split("\n").length,
  };
  plan.reservations.push({
    id,
    ownerOccurrence: owner.id,
    ownerAppearance: owner.appearance,
    profileId: `${role}/1`,
    space: "sheet-slot",
    inkMm,
    maximumForms: [maximum],
  });
  plan.annotations.push({
    id,
    ownerOccurrence: owner.id,
    ownerOccurrences: members.map((m) => m.id),
    role,
    targets,
    text: lines,
    primitiveIds: [`${id}/ink`],
    reservationId: id,
  });
}
function gangMembers(
  ir: Readonly<ElectricalIr>,
  owner: PlacedOccurrence,
  all: readonly PlacedOccurrence[],
  sheets: readonly RenderedSheet[],
) {
  const group = ir.gangedGroups.find((g) =>
    g.functionIds.some((f) => sameFunction(f, owner.source)),
  );
  if (!group) return [owner];
  const key = (o: PlacedOccurrence) =>
    JSON.stringify(contactCoils(ir, o.source));
  const visible = all.filter(
    (o) =>
      o.role === "full-function" &&
      o.destination.sheet === owner.destination.sheet &&
      o.provenance.view.key === owner.provenance.view.key &&
      o.source.deviceUid === owner.source.deviceUid &&
      group.functionIds.some((f) => sameFunction(f, o.source)) &&
      key(o) === key(owner),
  );
  const svg =
    sheets.find((s) => s.number === owner.destination.sheet)?.svg ?? "";
  const linked = navigationGeometry(svg)
    .filter(
      (g) =>
        g.visible &&
        g.node.attrs["data-mechanical-association"] === "ganged" &&
        (!g.viewKey || g.viewKey === owner.provenance.view.key),
    )
    .flatMap(
      (g) =>
        JSON.parse(
          g.node.attrs["data-ganged-functions"] ?? "[]",
        ) as import("@thermite/compiler").FunctionId[],
    );
  return visible.length > 1 &&
    visible.every((o) => linked.some((f) => sameFunction(f, o.source)))
    ? visible
    : [owner];
}
