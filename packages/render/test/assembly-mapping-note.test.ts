import { afterAll, beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { connectorFixture } from "../../compiler/test/connector-fixture.js";
import { buildDocumentation } from "@thermite/query";
import {
  prepareConnectorAssemblyDrawing,
  prepareConnectorAssemblyPages,
} from "../src/connector-assembly.js";

let fixture: Awaited<ReturnType<typeof connectorFixture>>;
beforeAll(async () => {
  fixture = await connectorFixture((_types, objects) => {
    const cap = objects.find(
      (o) => o.kind === "device" && o.designation === "CAP1",
    );
    const link = objects.find(
      (o) => o.kind === "relation" && o.designation === "CAP-X2",
    );
    if (
      !cap ||
      cap.kind !== "device" ||
      !link ||
      link.kind !== "relation" ||
      !link.assembly
    )
      throw new Error("missing fixture cap");
    link.assembly.pinMapping.reason = "None";
    objects.push({
      ...cap,
      uid: "42000000-0000-4000-8000-000000000006",
      designation: "CAP2",
    });
    objects.push({
      ...link,
      uid: "42000000-0000-4000-8000-000000000016",
      designation: "CAP-X3",
      to: { device: "CAP2" },
      assembly: { ...link.assembly, fromPort: "X3" },
    });
  });
});
afterAll(async () => {
  await fixture.dispose();
});
function ir() {
  if (!fixture.result.ok)
    throw new Error(JSON.stringify(fixture.result.diagnostics));
  return fixture.result.ir;
}
it("states not-applicable on an intact cap without inventing unresolved cable mappings", async () => {
  const drawing = await prepareConnectorAssemblyDrawing(ir(), {
    format: "connector-assembly-view-request/0.1",
    assemblies: ["CAP-X2"],
  });
  expect(drawing.note).toContain("1 pin mapping not applicable");
  expect(drawing.note).toContain("1 selected assembly.");
  expect(drawing.note).not.toContain("1 selected assemblies");
  expect(drawing.note).not.toMatch(/unresolved|cable pin mapping/);
  expect(drawing.topologyCoverage?.relationIds).toHaveLength(1);
  const link = parseHTML(drawing.content).document.querySelector(
    "[data-connector-assembly]",
  );
  expect(link?.getAttribute("data-pin-mapping")).toBe("not-applicable");
  expect(link?.querySelector("title")?.textContent).toBe("None");
  const report = buildDocumentation(ir(), {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
  expect(
    report.rows.some((r) => r.cells.some((c) => c.endsWith("\nNone"))),
  ).toBe(true);
});
it("retains real unresolved cable mappings and describes both states in a mixed selection", async () => {
  const cable = await prepareConnectorAssemblyDrawing(ir(), {
    format: "connector-assembly-view-request/0.1",
    assemblies: ["W1"],
  });
  expect(cable.note).toContain("cable pin mapping is unresolved");
  expect(cable.note).not.toContain("not applicable");
  const mixed = await prepareConnectorAssemblyDrawing(ir(), {
    format: "connector-assembly-view-request/0.1",
    assemblies: ["CAP-X2", "W1"],
  });
  expect(mixed.note).toContain("2 selected assemblies.");
  expect(mixed.note).toContain(
    "1 unresolved pin mapping; 1 pin mapping not applicable",
  );
  expect(mixed.topologyCoverage?.relationIds).toHaveLength(2);
});
it("keeps cap truth and complete identities in every partition without losing authored notes", async () => {
  const drawings = await prepareConnectorAssemblyPages(
    ir(),
    {
      format: "connector-assembly-view-request/0.1",
      assemblies: ["CAP-X2", "CAP-X3"],
      notes: ["Authored note"],
    },
    (drawing) => drawing.topologyCoverage?.relationIds.length === 1,
  );
  expect(drawings).toHaveLength(2);
  expect(
    drawings.flatMap((d) => d.topologyCoverage?.relationIds ?? []),
  ).toHaveLength(2);
  for (const d of drawings) {
    expect(d.note).toContain("pin mapping not applicable");
    expect(d.note).not.toContain("unresolved");
  }
  expect(drawings.filter((d) => d.note.includes("Authored note"))).toHaveLength(
    1,
  );
});
