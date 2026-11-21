import type { Presentation } from "./model.js";
/** Mechanical frame defaults only. Business facts stay in the knownness ledger. */
export function presentationSettings(presentation: Presentation) {
  return {
    backgroundColor: presentation.backgroundColor ?? "#ffffff",
    page: {
      size: presentation.page?.size ?? "tabloid",
      orientation: presentation.page?.orientation ?? "landscape",
      marginMm: presentation.page?.marginMm ?? 10,
    },
    profile: presentation.titleBlock?.profile ?? "compact",
    lines: presentation.titleBlock?.lines ?? [],
    zones: presentation.frame?.zones ?? { default: { columns: 6, rows: 4 } },
    header: presentation.frame?.header ?? { text: "THERMITE / ELECTRICAL" },
    generatorStamp: presentation.frame?.generatorStamp ?? "border",
  } as const;
}
