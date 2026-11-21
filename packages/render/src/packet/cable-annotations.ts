import { required } from "../presentation/util.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { buildCableSchedule } from "@thermite/query";
import type {
  NormalizedSchematicView,
  PresentationLabel,
  RenderOutcome,
} from "../types.js";
import {
  authoredTerminalIncidence,
  omittedConnections,
} from "../off-view/incidence.js";
import { conductorKey } from "../presentation/util.js";
import { createOffViewCard } from "../off-view/card.js";
import { preflightOffViewSources } from "../svg/escape.js";

export type CableEndpointCards = readonly (readonly [
  PresentationLabel | undefined,
  PresentationLabel | undefined,
])[];

export function cableEndpointCards(
  ir: Readonly<ElectricalIr>,
  schedule: ReturnType<typeof buildCableSchedule>,
  view: NormalizedSchematicView,
  widthMm: number,
): RenderOutcome<CableEndpointCards> {
  const incidence = authoredTerminalIncidence(ir);
  // Every depicted core counts, including assigned one-ended spares.
  const drawn = new Set(
    schedule.cores.map((core) =>
      conductorKey({
        kind: "cable_conductor",
        cableUid: schedule.cableUid,
        conductorId: core.id,
      }),
    ),
  );
  const cards = schedule.cores.map(
    (core) =>
      core.endpoints.map((end, index) => {
        if (!end) return undefined;
        const omitted = omittedConnections(incidence, end.terminal, drawn);
        return omitted.length
          ? createOffViewCard(
              end.terminal,
              end.display,
              omitted,
              "port",
              JSON.stringify([schedule.cableUid, core.id, index]),
              widthMm / 0.25,
            )
          : undefined;
      }) as [PresentationLabel | undefined, PresentationLabel | undefined],
  );
  const preflight = preflightOffViewSources(
    view,
    cards.flatMap((ends) => ends.flatMap((c) => c?.textSources ?? [])),
  );
  return preflight.ok ? { ok: true, value: cards } : preflight;
}

export function cableCardContext(cards: CableEndpointCards[number]): string {
  return cards
    .flatMap((card) =>
      card
        ? [
            `${required(card.offView, "Missing off-view card").terminalName}: ${required(
              card.offView,
              "Missing off-view card",
            )
              .connections.map((c) => c.designation)
              .join(", ")}`,
          ]
        : [],
    )
    .join("; ");
}

export function cableRowHeight(
  cards: CableEndpointCards[number],
  rows: readonly (readonly string[])[],
  usageExtraHeight = 0,
) {
  const labelHeight = Math.max(...rows.map((r) => r.length)) * 4;
  const height = Math.max(0, ...cards.map((c) => (c ? c.height * 0.25 : 0)));
  return Math.max(
    19,
    labelHeight + (height ? height + 10 : 12) + usageExtraHeight,
  );
}
