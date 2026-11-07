import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type { DocumentationRequest } from "@thermite/query";
import type { CircuitViewRequest } from "../circuit.js";
import type { CommunicationViewRequest } from "../communication.js";
import type { ConnectorAssemblyViewRequest } from "../connector-assembly.js";
import type { SignalLoopViewRequest } from "../signal-loop.js";
import type { WiringViewRequest } from "../wiring.js";
import type { SchematicViewRequest, RenderOutcome } from "../types.js";
import type { Draft, PaperPage, SchematicPacketRequest } from "./types.js";
import { record } from "./errors.js";
import { circuitDrafts } from "./circuit.js";
import { topologyDrafts } from "./topology.js";
import { cableDrafts } from "./cable.js";
import { drawingDrafts } from "./rooted.js";
import { documentationDrafts } from "./reports.js";

/** Dispatch one authored view without changing family-specific failure boundaries. */
export async function viewDrafts(
  ir: Readonly<ElectricalIr>,
  view: unknown,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  layout: SchematicPacketRequest["layout"],
  circuitAppearances: Map<string, string[]>,
): Promise<RenderOutcome<Draft[]>> {
  return record(view) && view.format === "circuit-view-request/0.1"
    ? await circuitDrafts(
        ir,
        view as unknown as CircuitViewRequest,
        presentation,
        page,
        circuitAppearances,
      )
    : record(view) &&
        (view.format === "communication-view-request/0.1" ||
          view.format === "connector-assembly-view-request/0.1" ||
          view.format === "signal-loop-view-request/0.1" ||
          view.format === "wiring-view-request/0.1")
      ? await topologyDrafts(
          ir,
          view as unknown as
            | CommunicationViewRequest
            | ConnectorAssemblyViewRequest
            | SignalLoopViewRequest
            | WiringViewRequest,
          presentation,
          page,
        )
      : record(view) && view.format === "documentation-view-request/0.1"
        ? documentationDrafts(
            ir,
            view as unknown as DocumentationRequest,
            presentation,
            page,
          )
        : record(view) &&
            record(view.intent) &&
            view.intent.kind === "conductors"
          ? await cableDrafts(
              ir,
              view as unknown as SchematicViewRequest,
              presentation,
              page,
            )
          : await drawingDrafts(
              ir,
              view as SchematicViewRequest,
              presentation,
              page,
              layout,
            );
}
