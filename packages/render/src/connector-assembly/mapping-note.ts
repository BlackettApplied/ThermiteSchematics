import type { ConnectorAssemblyInventory } from "@thermite/query";

type AssemblyLink = ConnectorAssemblyInventory["assemblies"][number];

export function assemblyMappingNote(links: readonly AssemblyLink[]): string {
  if (
    links.length > 0 &&
    links.every(
      (l) =>
        l.assembly.kind === "cable" &&
        l.assembly.pinMapping.status === "unresolved",
    )
  )
    return "cable pin mapping is unresolved";
  const unresolved = links.filter(
    (l) => l.assembly.pinMapping.status === "unresolved",
  ).length;
  const notApplicable = links.filter(
    (l) => l.assembly.pinMapping.status === "not-applicable",
  ).length;
  return (
    [
      ...(unresolved
        ? [`${unresolved} unresolved pin mapping${unresolved === 1 ? "" : "s"}`]
        : []),
      ...(notApplicable
        ? [
            `${notApplicable} pin mapping${notApplicable === 1 ? "" : "s"} not applicable`,
          ]
        : []),
    ].join("; ") || "no pin mappings selected"
  );
}
