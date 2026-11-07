import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import { buildCableSchedule, createQueryEngine } from "@thermite/query";

import {
  escapeXmlAttribute as attr,
  preflightTitleRenderText,
} from "../svg/escape.js";
import { prepareSchematicTitleContext } from "../title-block.js";
import type { RenderOutcome, SchematicViewRequest } from "../types.js";
import { normalizeSchematicView } from "../view-spec.js";

import type { Draft, PaperPage, SheetReference } from "./types.js";
import { failure } from "./errors.js";
import { bounds, zone } from "./page.js";
import { n, text, line, wrap } from "./svg.js";

export async function cableDrafts(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): Promise<RenderOutcome<Draft[]>> {
  const normalized = normalizeSchematicView(ir, request);
  if (!normalized.ok) return normalized;
  const view = normalized.value.view;
  if (view.format !== "schematic-view/0.2" || view.intent !== "conductors")
    throw new Error("Expected a cable view.");
  const queried = createQueryEngine(ir).cable(request.root);
  if (!queried.ok) return queried;
  const schedule = buildCableSchedule(ir, view.root.cableUid);
  const preparedTitle = prepareSchematicTitleContext(
    ir.project.name,
    view,
    presentation,
  );
  if (!preparedTitle.ok) return preparedTitle;
  const title = preparedTitle.value,
    b = bounds(title, page);
  const sources = cableLabelSources(schedule);
  const preflight = preflightTitleRenderText(
    view,
    sources.map((value) => ({
      ownerKind: "cable",
      ownerId: schedule.cableUid,
      field: "title.authored-line",
      value,
    })),
  );
  if (!preflight.ok) return preflight;
  const left = b.x,
    right = b.x + b.w,
    jacketL = left + b.w * 0.35,
    jacketR = right - b.w * 0.35;
  const maxEnd = Math.floor((jacketL - left - 8) / 1.55);
  if (maxEnd < 12 || sources.some((value) => [...value].length > 160))
    return failure(
      "unprintable-layout",
      "Cable labels exceed the supported print width. Shorten labels or use a larger page.",
    );
  const drafts: Draft[] = [];
  let content: string[] = [],
    refs: SheetReference[] = [],
    y = b.y,
    first = 0;
  function header() {
    refs = [];
    content = [
      text(left, b.y + 4, `CABLE ${schedule.designation}`, 4, "start", 700),
      text(left, b.y + 10, schedule.typeId, 2.6),
      text(
        left,
        b.y + 16,
        `${schedule.counts.total} cores / ${schedule.counts.spare} spare / ${schedule.counts.unassigned} unassigned`,
        2.6,
      ),
    ];
    const a = schedule.fromLocation ?? "END A",
      z = schedule.toLocation ?? "END B";
    if (
      a.length > maxEnd ||
      z.length > maxEnd ||
      schedule.typeId.length * 1.5 > b.w
    )
      return false;
    content.push(
      text(left, b.y + 25, a, 3, "start", 700),
      text(right, b.y + 25, z, 3, "end", 700),
    );
    y = b.y + 33;
    return true;
  }
  function finish(last: number) {
    const jacket = `<rect x="${n(jacketL)}" y="${n(b.y + 29)}" width="${n(jacketR - jacketL)}" height="${n(y - b.y - 24)}" rx="3" fill="none" stroke="#667085" stroke-width="0.45" stroke-dasharray="2 1"/>`;
    content.push(
      jacket,
      text(
        left,
        y + 13,
        "Solid: assigned   Dashed: spare   X: unterminated   ?: unassigned",
        2.5,
      ),
      text(
        left,
        y + 18,
        schedule.shield === true
          ? "Shielded construction; shield terminations are not specified by this view."
          : "Shield termination is not inferred from cable construction.",
        2.5,
      ),
    );
    drafts.push({
      view,
      title,
      content: content.join("\n"),
      links: [],
      references: refs,
      note: `Core inventory ${first + 1}-${last} of ${schedule.cores.length}. ${schedule.endOrder === "canonical" ? "Legacy endpoints shown in canonical order." : "End A/B follows authored endpoint order."}`,
    });
  }
  if (!header())
    return failure(
      "unprintable-layout",
      "Cable cabinet or type labels are too long for this page.",
    );
  for (let i = 0; i < schedule.cores.length; i++) {
    const core = schedule.cores[i]!;
    const leftEnd = core.endpoints[0],
      rightEnd = core.endpoints[1];
    const a =
      leftEnd === null
        ? [core.status === "unassigned" ? "? UNASSIGNED" : "X UNTERMINATED"]
        : wrap(leftEnd.display, maxEnd);
    const z =
      rightEnd === null
        ? [core.status === "unassigned" ? "? UNASSIGNED" : "X UNTERMINATED"]
        : wrap(rightEnd.display, maxEnd);
    const center = `${core.id} / ${core.color}${core.size ? ` / ${core.size}` : ""}`;
    const centerRows = wrap(center, Math.floor((jacketR - jacketL - 6) / 1.5));
    const height = Math.max(
      19,
      Math.max(a.length, z.length, centerRows.length) * 4 + 12,
    );
    if (y + height + 24 > b.y + b.h) {
      if (i === first)
        return failure(
          "unprintable-layout",
          "A cable core row cannot fit on this page. Shorten labels or use a larger page.",
        );
      finish(i);
      first = i;
      header();
    }
    const midY = y + Math.max(a.length, z.length, centerRows.length) * 4 + 1;
    const dashed = core.usage === "spare" || core.status === "unassigned";
    content.push(
      `<g data-cable-uid="${attr(schedule.cableUid)}" data-conductor-id="${attr(core.id)}" data-usage="${core.usage}" data-status="${core.status}">`,
      line(
        left + 1,
        midY,
        right - 1,
        midY,
        dashed ? 'stroke-dasharray="2 1"' : "",
      ),
    );
    a.forEach((row, index) =>
      content.push(text(left, y + index * 4 + 4, row, 2.7)),
    );
    z.forEach((row, index) =>
      content.push(text(right, y + index * 4 + 4, row, 2.7, "end")),
    );
    centerRows.forEach((row, index) =>
      content.push(
        text((left + right) / 2, y + index * 4 + 3, row, 2.6, "middle"),
      ),
    );
    content.push(
      text(
        (left + right) / 2,
        midY + 4,
        core.usage === "unspecified"
          ? "ASSIGNED / USAGE UNSPECIFIED"
          : core.usage.toUpperCase(),
        2.2,
        "middle",
      ),
    );
    for (const [end, x] of [
      [leftEnd, left + 1],
      [rightEnd, right - 1],
    ] as const) {
      if (end === null)
        content.push(
          line(x - 1, midY - 1, x + 1, midY + 1),
          line(x - 1, midY + 1, x + 1, midY - 1),
        );
      else {
        refs.push({
          deviceUid: end.terminal.deviceUid,
          designation: ir.devices.find((d) => d.uid === end.terminal.deviceUid)!
            .designation,
          functions: [],
          zone: zone(x, midY, b),
        });
        content.push(
          `<circle cx="${n(x)}" cy="${n(midY)}" r="0.8" fill="white" stroke="#344054" stroke-width="0.3"/>`,
        );
      }
    }
    content.push("</g>");
    y += height;
  }
  finish(schedule.cores.length);
  return { ok: true, value: drafts };
}

function cableLabelSources(
  schedule: ReturnType<typeof buildCableSchedule>,
): string[] {
  return schedule.cores
    .flatMap((core) => [
      core.id,
      core.color,
      core.size ?? "",
      ...core.endpoints.flatMap((end) =>
        end === null ? [] : [end.display, end.location ?? ""],
      ),
    ])
    .concat(
      schedule.fromLocation ?? "",
      schedule.toLocation ?? "",
      schedule.typeId,
    );
}
