import type { ElectricalIr } from "@thermite/compiler";
import {
  inside,
  expand,
  project,
  intersection,
} from "../device-legend/geometry.js";
import { descendants } from "../device-legend/svg-tree.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import type { Draft, RenderedSheet } from "./types.js";
import type {
  PlacedOccurrence,
  NativeOccurrenceSeed,
  NavigationView,
} from "./navigation-types.js";
import { navigationZone, roundNavigation } from "./navigation-location.js";
import { navigationDraftInputs } from "./navigation-seeds.js";
import { navigationHash } from "./navigation-identity.js";
import { required } from "../presentation/util.js";

function visibleTerminals(
  seed: NativeOccurrenceSeed,
  geometry: NavigationGeometry,
  all: readonly NavigationGeometry[],
) {
  const scope = seed.terminalScopeId
    ? required(
        all.find(
          (g) =>
            g.node.attrs.id?.endsWith(seed.terminalScopeId ?? "") &&
            descendants(g.node).includes(geometry.node),
        ),
        "Missing circuit terminal scope",
      ).node
    : geometry.node;
  const children = new Set(descendants(scope));
  const terminals = all.filter(
    (g) =>
      children.has(g.node) &&
      seed.terminals.some((t) => g.node.attrs.id?.endsWith(t.primitiveId)),
  );
  return terminals.filter(
    (g) =>
      g.visible &&
      inside(
        project(
          {
            x: Number(g.node.attrs.cx),
            y: Number(g.node.attrs.cy),
            w: 0,
            h: 0,
          },
          g.matrix,
        ),
        expand(g.clip, 0.002),
      ),
  );
}

export function terminalCentroid(
  keys: readonly string[],
  visible: readonly NavigationGeometry[],
) {
  const points = keys.map((k) => {
    const markers = visible
      .filter((v) => v.node.attrs["data-terminal-key"] === k)
      .map((g) =>
        project(
          {
            x: Number(g.node.attrs.cx),
            y: Number(g.node.attrs.cy),
            w: 0,
            h: 0,
          },
          g.matrix,
        ),
      );
    const centers = [
      ...new Map(markers.map((p) => [JSON.stringify([p.x, p.y]), p])).values(),
    ];
    return {
      x: centers.reduce((s, p) => s + p.x, 0) / centers.length,
      y: centers.reduce((s, p) => s + p.y, 0) / centers.length,
    };
  });
  return {
    x: roundNavigation(points.reduce((s, p) => s + p.x, 0) / points.length),
    y: roundNavigation(points.reduce((s, p) => s + p.y, 0) / points.length),
  };
}

function occurrence(
  ir: Readonly<ElectricalIr>,
  seed: NativeOccurrenceSeed,
  geometry: NavigationGeometry,
  all: readonly NavigationGeometry[],
  view: NavigationView,
  sheet: number,
  draft: Draft,
): PlacedOccurrence | undefined {
  const fn = required(
    ir.functions.find(
      (f) =>
        f.id.deviceUid === seed.source.deviceUid &&
        f.id.functionKey === seed.source.functionKey,
    ),
    "Unknown navigation source function",
  );
  const ownerUid = geometry.node.attrs["data-device-uid"],
    ownerFunction = geometry.node.attrs["data-function-key"];
  if (
    (ownerUid && ownerUid !== seed.source.deviceUid) ||
    (ownerFunction && ownerFunction !== seed.source.functionKey)
  )
    throw Error("Glyph source ownership mismatch");
  const body = project(seed.body, geometry.matrix),
    clip = geometry.clip;
  if (!geometry.visible || !intersection(body, clip)) return;
  const visible = visibleTerminals(seed, geometry, all);
  if (!visible.length) return;
  if (
    visible.some(
      (g) => g.node.attrs["data-device-uid"] !== seed.source.deviceUid,
    )
  )
    throw Error("Terminal source ownership mismatch");
  const keys = [
    ...new Set(
      visible.map((g) =>
        required(
          g.node.attrs["data-terminal-key"],
          "Terminal has no source ownership",
        ),
      ),
    ),
  ];
  const complete = fn.terminals.every((t) => keys.includes(t.terminalKey));
  const role =
    seed.representation === "terminal" || seed.representation === "boundary"
      ? "terminal-context"
      : !seed.fragmentEndpoints && complete && inside(body, expand(clip, 0.002))
        ? "full-function"
        : "boundary-fragment";
  const anchorMm = terminalCentroid(keys, visible);
  return locatedOccurrence(
    seed,
    geometry,
    view,
    sheet,
    draft,
    keys,
    visible,
    role,
    anchorMm,
    fn.source,
  );
}
function locatedOccurrence(
  seed: NativeOccurrenceSeed,
  geometry: NavigationGeometry,
  view: NavigationView,
  sheet: number,
  draft: Draft,
  keys: string[],
  visible: readonly NavigationGeometry[],
  role: PlacedOccurrence["role"],
  anchorMm: { x: number; y: number },
  source: PlacedOccurrence["sourceOrigins"][number],
): PlacedOccurrence {
  const body = project(seed.body, geometry.matrix),
    clip = geometry.clip;
  const appearance = JSON.stringify([view.key, seed.logicalKey]);
  const fragmentKey =
    role === "boundary-fragment"
      ? JSON.stringify([keys.slice().sort(), seed.fragmentEndpoints])
      : undefined;
  const identity = [
    seed.source.deviceUid,
    seed.source.functionKey,
    appearance,
    role,
    fragmentKey,
  ];
  return {
    id: `occurrence/1/${navigationHash(identity)}`,
    source: seed.source,
    appearance,
    role,
    representation: seed.representation,
    terminalKeys: keys,
    sourceOrigins: [source],
    ...(fragmentKey ? { fragmentKey, parentAppearance: appearance } : {}),
    destination: {
      sheet,
      zone: navigationZone(
        anchorMm.x,
        anchorMm.y,
        required(draft.drawingBounds, "Missing navigation drawing field"),
      ),
      anchorMm,
      anchorRule: "function-terminal-centroid/2",
    },
    primitiveIds: [
      required(geometry.node.attrs.id, "Missing occurrence primitive"),
    ],
    terminalPrimitiveIds: visible.map((g) =>
      required(g.node.attrs.id, "Missing terminal primitive"),
    ),
    provenance: {
      symbolKey: JSON.stringify([
        view.key,
        seed.terminalScopeId ?? seed.logicalKey,
      ]),
      transform: geometry.matrix,
      clipMm: clip,
      bodyMm: body,
      view,
    },
  };
}
export function placeOccurrences(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
): PlacedOccurrence[] {
  const seeds = new Map<
    string,
    { seed: NativeOccurrenceSeed; view: NavigationView }[]
  >();
  for (const input of navigationDraftInputs(drafts)) {
    const entries = seeds.get(input.view.key) ?? [];
    for (const seed of input.seeds)
      if (
        !entries.some(
          (e) =>
            e.seed.nativeId === seed.nativeId &&
            e.seed.logicalKey === seed.logicalKey &&
            e.seed.source.functionKey === seed.source.functionKey,
        )
      )
        entries.push({ seed, view: input.view });
    seeds.set(input.view.key, entries);
  }
  const result = sheets.flatMap((sheet, i) => {
    const all = navigationGeometry(sheet.svg);
    return all.flatMap((g) => {
      const native = g.node.attrs["data-navigation-native"];
      if (
        g.visible &&
        (g.node.attrs["data-function-key"] ||
          (g.node.attrs["data-aggregate-key"] &&
            /symbol/.test(g.node.attrs.class ?? ""))) &&
        !native
      )
        throw Error("Full glyph has no navigation ownership");
      if (!native) return [];
      const matching = (seeds.get(g.viewKey) ?? []).filter(
        (e) => e.seed.nativeId === native,
      );
      if (!matching.length) throw Error("Navigation ink has no source seed");
      return matching.flatMap(
        ({ seed, view }) =>
          occurrence(
            ir,
            seed,
            g,
            all,
            view,
            sheet.number,
            required(drafts[i], "Missing occurrence draft"),
          ) ?? [],
      );
    });
  });
  validateSelectedInk(seeds, result, ir);
  const ids = new Set<string>();
  for (const o of result) {
    if (ids.has(o.id))
      throw Error(
        `Duplicate navigation occurrence identity for ${o.source.functionKey}`,
      );
    ids.add(o.id);
  }
  return result;
}
/** All function report projections share the final centroid; device-only rows retain their anchor. */
export function centroidReferences(
  drafts: Draft[],
  occurrences: readonly PlacedOccurrence[],
) {
  for (const [i, draft] of drafts.entries())
    draft.references = (draft.references ?? []).flatMap((r) => {
      if (!r.functions.length) return [r];
      const locations = r.functions.flatMap((key) => {
        const matches = occurrences.filter(
          (o) =>
            o.destination.sheet === i + 1 &&
            o.source.deviceUid === r.deviceUid &&
            o.source.functionKey === key &&
            (r.representation === "terminal"
              ? o.role === "terminal-context"
              : o.role === "full-function" || o.role === "boundary-fragment"),
        );
        return matches.length
          ? matches.map((o) => ({
              ...r,
              xMm: o.destination.anchorMm.x,
              yMm: o.destination.anchorMm.y,
              zone: o.destination.zone,
            }))
          : [r];
      });
      return [...new Map(locations.map((l) => [l.zone, l])).values()];
    });
}

function validateSelectedInk(
  seeds: ReadonlyMap<
    string,
    { seed: NativeOccurrenceSeed; view: NavigationView }[]
  >,
  result: readonly PlacedOccurrence[],
  ir: Readonly<ElectricalIr>,
) {
  for (const entries of seeds.values())
    for (const { seed, view } of entries) {
      const fn = required(
        ir.functions.find(
          (f) =>
            f.id.deviceUid === seed.source.deviceUid &&
            f.id.functionKey === seed.source.functionKey,
        ),
        "Unknown selected function",
      );
      if (!fn.terminals.length) continue; // Exported as a measurement gap until a catalog body anchor exists.
      if (
        !result.some(
          (o) =>
            o.appearance === JSON.stringify([view.key, seed.logicalKey]) &&
            o.source.deviceUid === seed.source.deviceUid &&
            o.source.functionKey === seed.source.functionKey,
        )
      )
        throw Error("Selected function has no visible occurrence ink");
    }
}
