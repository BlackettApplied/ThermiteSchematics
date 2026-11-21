import { afterAll, beforeAll, expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { renderSchematicPacket } from "../../packages/render/dist/index.js";
import { conveyorRequest } from "../../packages/render/test/packet-navigation-review-fixture.ts";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { peerReferenceFindings } from "./issued-reference-audit.mjs";
import { terminalPeerObligations } from "./terminal-peer-oracle.mjs";
import { nativeRows } from "./m3-native.mjs";

let browser, page, input;
beforeAll(async () => {
  input = await compileProject("examples/conveyor-line");
  if (!input.ok) throw Error(JSON.stringify(input.diagnostics));
  browser = await launch();
  page = await browser.newPage(drawingContextOptions);
});
afterAll(async () => browser?.close());

const measure = (svg) => openSheet(page, embedPrintableFont(svg));

function moveNote(svg, source, delta) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const note = [...document.querySelectorAll("[data-peer-reference]")].find(
    (e) => e.getAttribute("data-peer-source") === source,
  );
  if (!note) throw Error("Missing issued peer note");
  note.setAttribute("transform", `translate(0 ${delta})`);
  return document.toString();
}

it.each([
  ["letter", "standard"],
  ["a4", "standard"],
  ["a4", "compact"],
])(
  "measures owner proximity in %s portrait %s",
  async (size, layout) => {
    const packet = await renderSchematicPacket(
      input.ir,
      { ...conveyorRequest(), layout, page: { size, orientation: "portrait" } },
      input.presentation,
    );
    if (!packet.ok) throw Error(packet.error.message);
    const geometries = [];
    for (const sheet of packet.value.sheets)
      geometries.push(await measure(sheet.svg));
    const obligations = terminalPeerObligations(
      packet.value,
      geometries,
      input.ir,
      nativeRows(input.ir),
    );
    const [first] = geometries;
    const expected = obligations.filter((o) => o.sheet === 1);
    expect(peerReferenceFindings(1, first, expected)).toEqual([]);
    const uid = input.ir.wires.find((w) => w.designation === "W-PWR-009").uid;
    const owner = input.ir.devices.find((d) => d.designation === "SRC1").uid;
    const actual = first.texts.find((t) => {
      if (t.peerReference !== "conductor-peer") return false;
      const [from, wire] = JSON.parse(t.peerSource);
      return from.deviceUid === owner && wire.uid === uid;
    });
    expect(actual).toBeDefined();
    if (size === "letter") {
      const complete = input.ir.wires.find(
        (w) => w.designation === "W-PWR-002",
      ).uid;
      expect(
        first.texts.some(
          (t) =>
            t.peerReference === "conductor-peer" &&
            JSON.parse(t.peerSource)[1].uid === complete,
        ),
      ).toBe(false);
      const withoutRoute = packet.value.sheets[0].svg.replace(
        new RegExp(`<path(?=[^>]*data-wire-uid="${complete}")[^>]*\/>`, "gu"),
        "",
      );
      expect(withoutRoute).not.toBe(packet.value.sheets[0].svg);
      const ink = await measure(withoutRoute);
      const newObligations = terminalPeerObligations(
        packet.value,
        [ink, ...geometries.slice(1)],
        input.ir,
        nativeRows(input.ir),
      );
      expect(
        newObligations.some(
          (o) => o.sheet === 1 && o.source[1]?.uid === complete,
        ),
      ).toBe(true);
    }
    const moved = await measure(
      moveNote(
        packet.value.sheets[0].svg,
        actual.peerSource,
        actual.bbox.y > first.height / 2 ? -45 : 45,
      ),
    );
    expect(peerReferenceFindings(1, moved, expected)).toContainEqual(
      expect.objectContaining({ kind: "issued-peer-reference-owner-distance" }),
    );
  },
  // Each case renders a complete packet, then measures every sheet and its
  // negative controls in the shared browser. Match the runner's integration
  // test budget so loaded CI workers can finish all measurements.
  120_000,
);
