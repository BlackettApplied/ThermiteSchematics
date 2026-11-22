import type { ElectricalIr } from "@thermite/compiler";
import type { buildCableSchedule } from "@thermite/query";
import { planDeviceTag } from "../device-tags.js";
import { preflightDeviceTagSources } from "../svg/escape.js";
import {
  legendColumns,
  type LegendLayout,
} from "../device-legend/placement.js";
import type { LegendTag } from "../device-legend/reference.js";
import type { NormalizedSchematicView, RenderOutcome } from "../types.js";
import { required } from "../presentation/util.js";
import { cableRowPlan } from "./cable-row-plan.js";
import {
  cableRowHeight,
  cableCardContext,
  type CableEndpointCards,
} from "./cable-annotations.js";
import { failure } from "./errors.js";
type Core = ReturnType<typeof buildCableSchedule>["cores"][number];
type Blocks = (LegendLayout | undefined)[];
function referenceBlocks(
  ir: Readonly<ElectricalIr>,
  cores: readonly Core[],
  width: number,
  view: NormalizedSchematicView,
): RenderOutcome<Blocks> {
  const blocks: Blocks = [],
    seen = new Set<string>();
  for (const side of [0, 1]) {
    const tags: LegendTag[] = [];
    for (const core of cores) {
      const end = core.endpoints[side];
      if (!end || seen.has(end.terminal.deviceUid)) continue;
      const device = required(
          ir.devices.find((d) => d.uid === end.terminal.deviceUid),
          "Missing endpoint device",
        ),
        type = required(
          ir.deviceTypes.find((t) => t.id === device.typeId),
          "Missing endpoint type",
        ),
        plan = planDeviceTag(device, type, Math.min(50, width));
      if (!plan.ok) return plan;
      const valid = preflightDeviceTagSources(
        view,
        plan.value.fields.map((f) => f.source),
      );
      if (!valid.ok) return valid;
      seen.add(device.uid);
      tags.push({
        ...plan.value,
        referenceKey: end.display,
        referenceBlock: `reference:${device.uid}:${end.display}`,
      });
    }
    blocks.push(tags.length ? legendColumns(tags, 1) : undefined);
  }
  return { ok: true, value: blocks };
}
export const cableReferenceHeight = (blocks: Blocks) =>
  Math.max(0, ...blocks.map((b) => b?.box.h ?? 0));
interface PageRows {
  first: number;
  blocks: Blocks;
  rows: {
    core: Core;
    plan: Extract<ReturnType<typeof cableRowPlan>, { ok: true }>["value"];
    cards: CableEndpointCards[number];
    height: number;
  }[];
}
/** Plan the prospective endpoint set before accepting a row. A row and all its
 * local blocks move together; no separate reference-only sheet is possible. */
export function cableCorePages(
  ir: Readonly<ElectricalIr>,
  schedule: ReturnType<typeof buildCableSchedule>,
  cards: CableEndpointCards,
  view: NormalizedSchematicView,
  b: {
    left: number;
    right: number;
    jacketL: number;
    jacketR: number;
    height: number;
  },
): RenderOutcome<PageRows[]> {
  const pages: PageRows[] = [];
  let page: PageRows = { first: 0, blocks: [], rows: [] },
    used = 0;
  for (const [i, core] of schedule.cores.entries()) {
    const plan = cableRowPlan(core, schedule.designation, b);
    if (!plan.ok) return plan;
    const ends = required(cards[i], "Missing endpoint cards"),
      p = plan.value,
      height = cableRowHeight(ends, [p.a, p.z, p.centerRows], p.extraHeight);
    let blocks = referenceBlocks(
      ir,
      [...page.rows.map((r) => r.core), core],
      b.jacketL - b.left - 8,
      view,
    );
    if (!blocks.ok) return blocks;
    const fits = (candidate: Blocks) =>
      33 +
        cableReferenceHeight(candidate) +
        (candidate.some(Boolean) ? 3 : 0) +
        used +
        height +
        24 <=
      b.height;
    if (!fits(blocks.value) && page.rows.length) {
      pages.push(page);
      page = { first: i, blocks: [], rows: [] };
      used = 0;
      blocks = referenceBlocks(ir, [core], b.jacketL - b.left - 8, view);
      if (!blocks.ok) return blocks;
    }
    if (!fits(blocks.value))
      return failure(
        "unprintable-layout",
        `Cable ${schedule.designation}.${core.id} row plus referenced-device blocks cannot fit in the ${b.height.toFixed(2)} mm drawing area. ${cableCardContext(ends) ? `Endpoint cards: ${cableCardContext(ends)}. ` : ""}Use a larger page or change flow.`,
      );
    page.blocks = blocks.value;
    page.rows.push({ core, plan: p, cards: ends, height });
    used += height;
  }
  if (page.rows.length) pages.push(page);
  return { ok: true, value: pages };
}
