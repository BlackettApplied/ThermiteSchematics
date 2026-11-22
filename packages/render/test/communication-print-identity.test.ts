import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { parseHTML } from "linkedom";
import { openSync } from "fontkit";
import { prepareCommunicationDrawing } from "../src/communication.js";
import { renderSchematicPacket } from "../src/sheets.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/network-pagination");
  if (!compiled.ok) throw Error("compile network fixture");
  ir = structuredClone(compiled.ir);
  // Use a real branched node with multiple ports on the same and opposite sides.
  const links = ir.relations.filter((r) => r.connection?.medium === "ethernet");
  const hub = ir.devices.find(
    (d) =>
      links.filter((r) => r.fromDeviceUid === d.uid || r.toDeviceUid === d.uid)
        .length >= 4,
  )!;
  ir.relations = links.filter(
    (r) => r.fromDeviceUid === hub.uid || r.toDeviceUid === hub.uid,
  );
  for (const t of ir.deviceTypes)
    for (const p of Object.values(t.ports ?? {}))
      p.description = "Reader facing port description repeated at every socket";
});
const view = {
  format: "communication-view-request/0.1",
  medium: "ethernet",
} as const;
function verifyLabels(svg: string) {
  const doc = parseHTML(svg).document;
  for (const device of doc.querySelectorAll("g[data-device-uid]")) {
    const labels = [
      ...device.querySelectorAll("[data-communication-port]"),
    ].map((p) => {
      const label = [...p.querySelectorAll("text")]
        .map((t) => t.textContent)
        .join(" ");
      expect(label).toBe(
        `${p.getAttribute("data-communication-port")} — Reader facing port description repeated at every socket`,
      );
      return label;
    });
    expect(new Set(labels).size).toBe(labels.length);
  }
}
it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps distinct port identities in drawings and network schedules (%s)",
  async (_flow) => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        view,
        { format: "documentation-view-request/0.1", kind: "network" },
      ],
    });
    // Communication diagrams have their own fixed orientation; the packet also
    // uses the same labels in packets for either electrical flow.
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    for (const s of result.value.sheets.filter(
      (s) => s.view.kind === "communication",
    ))
      verifyLabels(s.svg);
    const table = buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "network",
    });
    for (const r of ir.relations) {
      const row = table.rows.find((row) => row.key === r.uid)!;
      for (const [column, uid, key] of [
        [2, r.fromDeviceUid, r.connection!.fromPort],
        [3, r.toDeviceUid, r.connection!.toPort],
      ] as const) {
        const name = ir.devices.find((d) => d.uid === uid)!.designation;
        expect(row.cells[column]).toContain(
          `${name}: ${key} — Reader facing port description repeated at every socket`,
        );
        expect(row.cells[column]).not.toContain(`${name}.${key}`);
      }
    }
  },
);
it("reserves width and height for opposing and adjacent wrapped port captions", async () => {
  const drawing = await prepareCommunicationDrawing(ir, view);
  verifyLabels(drawing.content);
  const font = openSync("packages/render/assets/fonts/NotoSans-Regular.ttf");
  if (!("unitsPerEm" in font)) throw Error("single font required");
  const doc = parseHTML(drawing.content).document;
  let opposing = 0,
    adjacent = 0;
  for (const owner of doc.querySelectorAll("g[data-device-uid]")) {
    const rect = owner.querySelector("rect")!;
    const width = Number(rect.getAttribute("width")),
      height = Number(rect.getAttribute("height"));
    const labels = [...owner.querySelectorAll("[data-communication-port]")].map(
      (p) => {
        const lines = [...p.querySelectorAll("text")].map((t) => ({
          x: Number(t.getAttribute("x")),
          y: Number(t.getAttribute("y")),
          w:
            (font
              .layout(t.textContent!)
              .glyphs.reduce((n, g) => n + g.advanceWidth, 0) *
              2.7) /
            font.unitsPerEm,
        }));
        expect(lines.length).toBeGreaterThan(1);
        for (const l of lines) {
          expect(l.x).toBeGreaterThanOrEqual(1.9);
          expect(l.x + l.w).toBeLessThan(width - 1.9);
          expect(l.y + 0.7).toBeLessThan(height);
        }
        return {
          side: Number(p.querySelector("circle")!.getAttribute("cx")) === 0,
          lines,
        };
      },
    );
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!,
          b = labels[j]!;
        if (a.side === b.side) {
          adjacent++;
          const [upper, lower] =
            a.lines[0]!.y < b.lines[0]!.y ? [a, b] : [b, a];
          expect(lower.lines[0]!.y - upper.lines.at(-1)!.y).toBeGreaterThan(
            2.7,
          );
        } else {
          opposing++;
          for (const x of a.lines)
            for (const y of b.lines)
              if (Math.abs(x.y - y.y) < 2.7)
                expect(Math.min(x.x + x.w, y.x + y.w)).toBeLessThan(
                  Math.max(x.x, y.x) - 2,
                );
        }
      }
  }
  expect(opposing).toBeGreaterThan(0);
  expect(adjacent).toBeGreaterThan(0);
});

it("keeps narrow port prose together while wrapping wide glyphs", async () => {
  const fixture = structuredClone(ir);
  const relation = fixture.relations[0]!;
  fixture.relations = [relation];
  const device = fixture.devices.find((d) => d.uid === relation.fromDeviceUid)!;
  const type = fixture.deviceTypes.find((t) => t.id === device.typeId)!;
  const key = relation.connection!.fromPort;
  const port = type.ports![key]!;
  const narrow = "i".repeat(36),
    wide = "W".repeat(36);
  async function lines(description: string) {
    port.description = description;
    const { content } = await prepareCommunicationDrawing(fixture, view);
    const doc = parseHTML(content).document;
    return [
      ...doc.querySelectorAll(
        `[data-device-uid="${device.uid}"] [data-communication-port="${key}"] text`,
      ),
    ].map((t) => t.textContent);
  }
  expect(await lines(narrow)).toContain(narrow);
  const wrapped = await lines(wide);
  expect(wrapped.length).toBeGreaterThan(1);
  expect(wrapped.join("").split("W").length - 1).toBe(wide.length);
});
