import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { plannedTitleContext } from "../internal/title-data/headings.js";
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type { PreparedCircuitView } from "../circuit.js";

export function circuitTitleContext(
  ir: Readonly<ElectricalIr>,
  prepared: PreparedCircuitView,
  presentation: CompiledProjectPresentation | undefined,
) {
  return plannedTitleContext(
    {
      projectName: ir.project.name,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: THERMITE_RELEASE_VERSION,
      lines: [
        {
          ownerKind: "view",
          ownerId: "circuit",
          field: "title.view-line",
          value: prepared.title,
        },
        ...(presentation?.titleBlockLines ?? []).map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line" as const,
          value,
        })),
      ],
    },
    presentation,
  );
}
