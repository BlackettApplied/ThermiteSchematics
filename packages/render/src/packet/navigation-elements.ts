import type { ElectricalIr } from "@thermite/compiler";
import type { PlacedOccurrence } from "./navigation-types.js";
import type { RepeatPlan } from "./navigation-repeats.js";
import { printedFunction } from "../print-projection.js";
import { sameFunction } from "./mirror-facts.js";
import { navigationHash } from "./navigation-identity.js";
import { required } from "../presentation/util.js";
import {
  distinctDestinations,
  envelopeShapes,
  maximumToken,
} from "./navigation-labels.js";

/** A shared native device establishes location, never actuation or continuity. */
export function planElementNavigation(
  ir: Readonly<ElectricalIr>,
  all: readonly PlacedOccurrence[],
): RepeatPlan {
  const plan: RepeatPlan = { groups: [], annotations: [], reservations: [] };
  const roles = elementRoles(ir);
  const power = (o: PlacedOccurrence) =>
    /^(Overload element|Breaker pole|Fuse element)\b/.test(
      roles.get(JSON.stringify(o.source)) ?? "",
    );
  const contact = (o: PlacedOccurrence) =>
    /^(NO|NC) contact\b/.test(roles.get(JSON.stringify(o.source)) ?? "");
  const groups = new Map<
    string,
    {
      owner: PlacedOccurrence;
      targets: PlacedOccurrence[];
      members: PlacedOccurrence[];
    }[]
  >();
  for (const owner of all) {
    if (owner.role !== "full-function" || (!power(owner) && !contact(owner)))
      continue;
    const targets = all.filter(
      (o) =>
        o.role === "full-function" &&
        o.source.deviceUid === owner.source.deviceUid &&
        !sameFunction(o.source, owner.source) &&
        (power(owner) ? contact(o) : power(o)),
    );
    if (!targets.length) continue;
    const key = JSON.stringify([
      owner.source.deviceUid,
      owner.destination.sheet,
      owner.provenance.view.key,
      targets.map((o) => o.id),
    ]);
    const clusters = groups.get(key) ?? [];
    const group = clusters.find((g) =>
      g.members.every((m) => nearbyElementAnchors(m, owner)),
    ) ?? { owner, targets, members: [] };
    if (!clusters.includes(group)) clusters.push(group);
    group.members.push(owner);
    groups.set(key, clusters);
  }
  for (const clusters of groups.values())
    for (const { owner, targets, members } of clusters)
      addElementLabel(plan, ir, owner, targets, roles, members);
  return plan;
}
function elementRoles(ir: Readonly<ElectricalIr>) {
  return new Map(
    ir.functions.map((f) => {
      const device = ir.devices.find((d) => d.uid === f.id.deviceUid);
      return [
        JSON.stringify(f.id),
        printedFunction(
          f,
          ir.deviceTypes.find((t) => t.id === device?.typeId),
        ),
      ];
    }),
  );
}
/** Distant drawn bodies need their own locator rather than a shared centroid. */
function nearbyElementAnchors(a: PlacedOccurrence, b: PlacedOccurrence) {
  return (
    Math.hypot(
      a.destination.anchorMm.x - b.destination.anchorMm.x,
      a.destination.anchorMm.y - b.destination.anchorMm.y,
    ) <= 60
  );
}
function addElementLabel(
  plan: RepeatPlan,
  ir: Readonly<ElectricalIr>,
  owner: PlacedOccurrence,
  targets: PlacedOccurrence[],
  roles: ReadonlyMap<string, string>,
  members: readonly PlacedOccurrence[],
) {
  const tag = required(
    ir.devices.find((d) => d.uid === owner.source.deviceUid),
    "Missing element device",
  ).designation;
  const byFunction = new Map<string, PlacedOccurrence[]>();
  for (const target of targets) {
    const key = JSON.stringify(target.source);
    byFunction.set(key, [...(byFunction.get(key) ?? []), target]);
  }
  const lines = (maximum: boolean) => elementLines(byFunction, roles, maximum);
  const shapes = (["local", "self-located"] as const).flatMap((mode) =>
    envelopeShapes(
      mode,
      [
        `${tag}${mode === "local" ? "" : ` (${maximumToken()})`}: ${lines(true)}`,
      ],
      [21],
    ),
  );
  const first = required(shapes[0], "Missing element envelope");
  const id = `element-location/1/${navigationHash(owner.id)}`;
  plan.reservations.push({
    id,
    ownerAppearance: owner.appearance,
    ownerOccurrence: owner.id,
    profileId: "same-device-elements/1",
    space: "sheet-slot",
    inkMm: first.inkMm,
    maximumForms: first.maximumForms,
    shapes,
  });
  plan.annotations.push({
    id,
    ownerOccurrence: owner.id,
    ownerOccurrences: members.map((o) => o.id),
    role: "element-location",
    targets: targets.map((o) => o.id),
    text: `${tag}: ${lines(false)}`,
    primitiveIds: [`${id}/ink`],
    reservationId: id,
  });
}

function elementLines(
  byFunction: ReadonlyMap<string, PlacedOccurrence[]>,
  roles: ReadonlyMap<string, string>,
  maximum: boolean,
) {
  const groups = new Map<string, string[]>();
  for (const [key, members] of byFunction) {
    const label = required(roles.get(key), "Missing printed element role");
    const role = required(
      label.match(
        /^(Overload element|Breaker pole|Fuse element|NO contact|NC contact)\b/,
      )?.[0],
      "Missing element role heading",
    );
    const destinations = maximum
      ? members.map(() => maximumToken())
      : distinctDestinations(members);
    const rows = groups.get(role) ?? [];
    rows.push(
      `${label.slice(role.length).trim()} → ${destinations.join(", ")}`,
    );
    groups.set(role, rows);
  }
  return [...groups]
    .map(
      ([role, rows]) =>
        `${role}${rows.length > 1 ? "\n" : " "}${rows.join("\n")}`,
    )
    .join("\n");
}
