import type { Draft, NativePartTarget } from "./types.js";
import {
  navigationGeometry,
  type NavigationGeometry,
} from "./navigation-walk.js";
import { navigationZone } from "./navigation-location.js";
import { descendants } from "../device-legend/svg-tree.js";
import { inside, project } from "../device-legend/geometry.js";
import { required } from "../presentation/util.js";

function markerZone(
  draft: Draft,
  markers: readonly NavigationGeometry[],
): string {
  const field = required(
    draft.drawingBounds,
    "Native part drawing bounds missing",
  );
  const points = markers.flatMap((g) => {
    const circle =
      g.node.name === "circle"
        ? g.node
        : g.node.children.find((n) => n.name === "circle");
    if (!g.visible || !circle || !(Number(circle.attrs.r) > 0)) return [];
    const p = project(
      {
        x: Number(circle.attrs.cx ?? 0),
        y: Number(circle.attrs.cy ?? 0),
        w: 0,
        h: 0,
      },
      g.matrix,
    );
    return inside(p, g.clip) && inside(p, field) ? [p] : [];
  });
  if (!points.length)
    throw Error("Native part destination has no visible terminal or port");
  const x = points.reduce((s, p) => s + p.x, 0) / points.length,
    y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return navigationZone(x, y, field);
}
function circuitZone(
  draft: Draft,
  group: string,
  part: number,
  terminal: string,
): string {
  const all = navigationGeometry(draft.content);
  const partNodes = new Set(
    all
      .filter((g) => g.node.attrs["data-circuit-part"] === String(part))
      .flatMap((g) => descendants(g.node)),
  );
  const scope = new Set(
    all
      .filter(
        (g) =>
          g.node.attrs["data-circuit-group"] === group && partNodes.has(g.node),
      )
      .flatMap((g) => descendants(g.node)),
  );
  const markers = all
    .filter(
      (g) => scope.has(g.node) && g.node.attrs["data-terminal-id"] === terminal,
    )
    .flatMap((g) =>
      all.filter(
        (m) => g.node.children.includes(m.node) && m.node.name === "circle",
      ),
    );
  return markerZone(draft, markers);
}
function portZone(draft: Draft, uid: string, key?: string): string {
  const markers = navigationGeometry(draft.content).filter(
    (g) =>
      g.deviceUid === uid &&
      g.node.attrs["data-communication-port"] &&
      (key === undefined || g.node.attrs["data-communication-port"] === key),
  );
  return markerZone(draft, key === undefined ? markers.slice(0, 1) : markers);
}
function destination(
  drafts: readonly Draft[],
  target: NativePartTarget,
): Draft {
  return required(
    drafts[target.sheet - 1],
    "Native part destination sheet missing",
  );
}
/** Final packet sheet positions resolve the reserved DTO, without changing native layout. */
export function resolveNativePartLocations(drafts: Draft[]): void {
  for (const draft of drafts) {
    for (const block of draft.circuitBlocks ?? [])
      for (const row of block.rows)
        for (const t of row.targets)
          t.zone = circuitZone(
            destination(drafts, t),
            block.group,
            t.part,
            row.id,
          );
    const block = draft.communicationBlock;
    if (!block) continue;
    for (const row of block.rows) {
      for (const t of row.targets)
        t.zone = portZone(destination(drafts, t), row.deviceUid);
      for (const port of row.ports ?? []) {
        const target = required(
          row.targets.find((t) =>
            destination(drafts, t).topologyCoverage?.some(
              (c) =>
                c.kind === "communication" &&
                c.ports.some(
                  (p) =>
                    p.deviceUid === row.deviceUid && p.portKey === port.key,
                ),
            ),
          ),
          "Native omitted-port destination missing",
        );
        port.targets = [
          {
            ...target,
            zone: portZone(
              destination(drafts, target),
              row.deviceUid,
              port.key,
            ),
          },
        ];
      }
    }
  }
}
