import { expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { normalizePaperPage } from "../src/packet/page.js";
import { wireScheduleLocations } from "../src/packet/wire-schedule-locations.js";
import { wireScheduleTerminalKeys } from "../src/packet/wire-schedule-terminals.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import { peerRouteIndex } from "../src/packet/peer-route-ink.js";
import { terminalPeerReferences } from "../src/packet/terminal-peer-references.js";
import {
  emitPeerReferences,
  type PeerReference,
} from "../src/packet/peer-reference-ink.js";
import { renderSchematicPacket } from "../src/sheets.js";
import type { Draft, RenderedSheet } from "../src/packet/types.js";
import { escapeXmlAttribute as attr } from "../src/svg/escape.js";
import { boxDistance } from "../src/packet/navigation-symbols.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { offViewFixture, parseSvg, required } from "./off-view-fixtures.js";

const DRAWING_BOUNDS = { x: 0, y: 0, w: 120, h: 80 };

function makeDraft(
  kind: "wiring" | "circuit",
  drawingBounds = DRAWING_BOUNDS,
): Draft {
  return {
    view: { format: "documentation-view/0.1", kind, title: "Fixture" },
    title: { title: "Fixture" },
    references: [],
    continuations: [],
    content: "",
    drawingBounds,
  };
}

function makeSheet(
  number: number,
  kind: "wiring" | "circuit",
  body: string,
): RenderedSheet {
  return {
    number,
    view: { format: "documentation-view/0.1", kind, title: "Fixture" },
    references: [],
    continuations: [],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">${body}</svg>`,
  };
}

function findFixtures(ir: Readonly<ElectricalIr>) {
  const ps1 = required(ir.devices.find((d) => d.designation === "PS1")).uid;
  const k1 = required(ir.devices.find((d) => d.designation === "K1")).uid;
  const w1 = required(ir.wires.find((w) => w.designation === "W1")).uid;
  return { ps1, k1, w1 };
}

function offViewCardSvg(
  ps1Uid: string,
  w1Uid: string,
  x: number,
  y: number,
): string {
  const terminalId = attr(
    JSON.stringify({ deviceUid: ps1Uid, terminalKey: "+" }),
  );
  const conductors = attr(JSON.stringify([{ kind: "wire", uid: w1Uid }]));
  return (
    `<g class="off-view-annotation" data-off-view-terminal-id="${terminalId}" data-off-view-conductors="${conductors}">` +
    `<rect x="${x}" y="${y}" width="40" height="14" fill="white" stroke="#101828" stroke-width="0.3"/>` +
    `<text class="off-view-heading" x="${x + 2}" y="${y + 4}" font-size="2.5" fill="#101828">Off-view at PS1.+</text>` +
    `<text class="off-view-row" x="${x + 2}" y="${y + 9}" font-size="2.5" fill="#101828">W1 → K1.A1</text>` +
    `</g>`
  );
}

it.each([
  [
    "schematic junction-dot",
    (uid: string) =>
      `<circle class="junction-dot" data-device-uid="${uid}" data-terminal-key="+" cx="50" cy="30" r="1" fill="#101828" stroke="none"/>`,
  ],
  [
    "circuit junction",
    (uid: string) =>
      `<circle data-circuit-junction="true" data-device-uid="${uid}" data-terminal-key="+" cx="50" cy="30" r=".55" fill="#17212b"/>`,
  ],
  [
    "wiring junction",
    (uid: string) =>
      `<circle data-wiring-junction="true" data-device-uid="${uid}" data-terminal-key="+" cx="50" cy="30" r=".65" fill="#344054"/>`,
  ],
  [
    "hidden circuit landing anchor",
    (uid: string) =>
      `<circle data-circuit-landing-for="p0" data-device-uid="${uid}" data-terminal-key="+" cx="50" cy="30" r=".001" fill="none" stroke="none"/>`,
  ],
  [
    "hidden wiring landing anchor",
    (uid: string) =>
      `<circle data-wiring-landing-for="p0" data-device-uid="${uid}" data-terminal-key="+" cx="50" cy="30" r=".001" fill="none" stroke="none"/>`,
  ],
])(
  "wireScheduleLocations ignores %s emitted before physical terminal-marker",
  async (_label, branchCircle) => {
    const fixture = await offViewFixture();
    try {
      const page = normalizePaperPage();
      if (!page.ok) throw Error("paper");
      const { ps1, k1, w1 } = findFixtures(fixture.ir);
      const physicalPs1 = `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>`;
      const physicalK1 = `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r="1" fill="white" stroke="#101828"/>`;
      // Branch circle is in zone B3 (x=50, y=30); physical PS1.+ is in zone B2 (x=30, y=30).
      const withPhysical = wireScheduleLocations(
        fixture.ir,
        [makeDraft("wiring")],
        [makeSheet(4, "wiring", branchCircle(ps1) + physicalPs1 + physicalK1)],
        page.value,
      );
      expect(withPhysical.get(w1)).toEqual(["04.B2", "04.B5"]);

      // A branch circle alone without a physical terminal must not invent a drawn zone.
      const branchOnly = wireScheduleLocations(
        fixture.ir,
        [makeDraft("wiring")],
        [makeSheet(4, "wiring", branchCircle(ps1) + physicalK1)],
        page.value,
      );
      expect(branchOnly.get(w1)).toEqual([undefined, "04.B5"]);
    } finally {
      await fixture.dispose();
    }
  },
);

it("terminalPeerReferences chooses physical terminal zone over preceding branch junction-dot and preserves alternates", async () => {
  const fixture = await offViewFixture();
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const { ps1, k1, w1 } = findFixtures(fixture.ir);
    // Sheet 1: junction-dot at B3 (50, 30) BEFORE physical terminal-marker at B2 (30, 30).
    const s1Body =
      `<circle class="junction-dot" data-device-uid="${ps1}" data-terminal-key="+" cx="50" cy="30" r="1" fill="#101828" stroke="none"/>` +
      `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>` +
      offViewCardSvg(ps1, w1, 2, 2);
    // Sheet 2: second physical appearance of PS1.+ at B2 (30, 30) with off-view card.
    const s2Body =
      `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>` +
      offViewCardSvg(ps1, w1, 2, 2);
    // Sheet 3: K1.A1 receives peer note pointing to PS1.+; must address 01.B2 (also shown 02.B2), never 01.B3.
    const s3Body = `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="70" cy="40" r="1" fill="white" stroke="#101828"/>`;

    const updated = terminalPeerReferences(
      fixture.ir,
      [makeDraft("wiring"), makeDraft("wiring"), makeDraft("circuit")],
      [
        makeSheet(1, "wiring", s1Body),
        makeSheet(2, "wiring", s2Body),
        makeSheet(3, "circuit", s3Body),
      ],
      page.value,
    );
    const notes = [
      ...parseSvg(updated[2]!.svg).querySelectorAll(
        '[data-peer-reference="conductor-peer"]',
      ),
    ].map((el) => el.textContent?.replace(/\s+/gu, " ").trim());
    expect(notes).toContain("W1 · K1.A1 → PS1.+ 01.B2 (also shown 02.B2)");
    expect(notes.join(" ")).not.toContain("01.B3");
  } finally {
    await fixture.dispose();
  }
});

it("terminalPeerReferences still suppresses redundant peer notes when a wire fans out from a terminal's junction-dot", async () => {
  const fixture = await offViewFixture();
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const { ps1, k1, w1 } = findFixtures(fixture.ir);
    // Sheet 1 draws both PS1.+ (B2), its branch junction-dot (B3), K1.A1 (B5), and W1 from the junction-dot to K1.A1.
    const s1Body =
      `<circle class="junction-dot" data-device-uid="${ps1}" data-terminal-key="+" cx="50" cy="30" r="1" fill="#101828" stroke="none"/>` +
      `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>` +
      `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r="1" fill="white" stroke="#101828"/>` +
      `<path class="wire-path" data-wire-uid="${w1}" d="M 50 30 H 90" fill="none" stroke="#101828" stroke-width="0.4"/>`;
    // Sheet 2 draws PS1.+ with an off-view card listing W1 → K1.A1.
    const s2Body =
      `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>` +
      offViewCardSvg(ps1, w1, 2, 2);

    const updated = terminalPeerReferences(
      fixture.ir,
      [makeDraft("wiring"), makeDraft("wiring")],
      [makeSheet(1, "wiring", s1Body), makeSheet(2, "wiring", s2Body)],
      page.value,
    );
    expect(
      parseSvg(updated[0]!.svg).querySelectorAll("[data-peer-reference]")
        .length,
    ).toBe(0);
  } finally {
    await fixture.dispose();
  }
});

it("emitPeerReferences never places a peer note nearer a foreign terminal than its owner or conductor support", () => {
  const sheet = makeSheet(
    7,
    "circuit",
    `<rect x="10" y="38" width="90" height="4" fill="#17212b"/>`,
  );
  const owner = { x: 20, y: 40, w: 1.3, h: 1.3 };
  const foreign = { x: 60, y: 39.35, w: 1.3, h: 1.3 };
  const along = [{ x: 35, y: 39.99, w: 18, h: 0.02 }];
  // Block slots near owner directly so placement must choose along-conductor or wrapped slot
  // while remaining nearer own support than the foreign terminal at x=60.
  const entry: PeerReference = {
    kind: "conductor-peer",
    identity: [
      { deviceUid: "ps1", terminalKey: "+" },
      { kind: "wire", uid: "w12" },
      { deviceUid: "s2", terminalKey: "11" },
    ],
    owner,
    foreignOwners: [foreign],
    along,
    ownerLabel: "PS1.+",
    value: "W-CTL-012 · PS1.+ → S2.11 07.B2",
    compact: "→ S2.11 07.B2",
    destination: "07.B2",
  };
  const field = { x: 26, y: 20, w: 80, h: 40 };
  const result = emitPeerReferences(sheet, field, [entry]);
  const doc = parseSvg(result.svg);
  const group = doc.querySelector('[data-peer-reference="conductor-peer"]');
  expect(group).not.toBeNull();
  const texts =
    group!.tagName.toLowerCase() === "text"
      ? [group!]
      : [...group!.querySelectorAll("text")];
  const boxes = texts.map((t) => {
    const x = Number(t.getAttribute("x"));
    const y = Number(t.getAttribute("y"));
    const m = printableTextMetrics(t.textContent ?? "", 2.5);
    return {
      x: x + m.left,
      y: y - m.top,
      w: m.right - m.left,
      h: m.top - m.bottom,
    };
  });
  const region = {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    w:
      Math.max(...boxes.map((b) => b.x + b.w)) -
      Math.min(...boxes.map((b) => b.x)),
    h:
      Math.max(...boxes.map((b) => b.y + b.h)) -
      Math.min(...boxes.map((b) => b.y)),
  };
  const ownerGap = Math.min(
    boxDistance(region, owner),
    ...along.map((a) => boxDistance(region, a)),
  );
  const foreignGap = boxDistance(region, foreign);
  expect(ownerGap).toBeLessThanOrEqual(foreignGap);
});

it("wireScheduleLocations resolves circuit boundary port groups carrying terminal identity on the parent group", async () => {
  const fixture = await offViewFixture();
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const { ps1, k1, w1 } = findFixtures(fixture.ir);
    const termId = attr(JSON.stringify([ps1, "+"]));
    // Circuit junction dot sits in B3 (50, 30); physical boundary port circle sits in B2 (30, 30)
    // with terminal identity on the parent <g> and an unkeyed child <circle>.
    const junction = `<circle data-circuit-junction="true" data-device-uid="${ps1}" data-terminal-key="+" cx="50" cy="30" r=".55" fill="#17212b"/>`;
    const boundaryPort =
      `<g data-device-uid="${ps1}">` +
      `<g data-layout-port="n0p0" data-terminal-id="${termId}" data-terminal-key="+">` +
      `<circle data-terminal-marker="true" cx="30" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `</g></g>`;
    const physicalK1 = `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r="1" fill="white" stroke="#101828"/>`;

    const result = wireScheduleLocations(
      fixture.ir,
      [makeDraft("circuit")],
      [makeSheet(1, "circuit", junction + boundaryPort + physicalK1)],
      page.value,
    );
    expect(result.get(w1)).toEqual(["01.B2", "01.B5"]);
  } finally {
    await fixture.dispose();
  }
});

function noteBoundingBox(group: Element) {
  const texts =
    group.tagName.toLowerCase() === "text"
      ? [group]
      : [...group.querySelectorAll("text")];
  const boxes = texts.map((t) => {
    const x = Number(t.getAttribute("x"));
    const y = Number(t.getAttribute("y"));
    const m = printableTextMetrics(t.textContent ?? "", 2.5);
    return {
      x: x + m.left,
      y: y - m.top,
      w: m.right - m.left,
      h: m.top - m.bottom,
    };
  });
  return {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    w:
      Math.max(...boxes.map((b) => b.x + b.w)) -
      Math.min(...boxes.map((b) => b.x)),
    h:
      Math.max(...boxes.map((b) => b.y + b.h)) -
      Math.min(...boxes.map((b) => b.y)),
  };
}

function assertMarkedPortGroups(svg: string) {
  const groups = [
    ...parseSvg(svg).querySelectorAll("g[data-layout-port][data-terminal-id]"),
  ];
  expect(groups.length).toBeGreaterThan(0);
  for (const group of groups)
    expect(
      group.querySelectorAll(':scope > circle[data-terminal-marker="true"]')
        .length,
    ).toBe(1);
}

function assertScheduleLocators(
  ir: Readonly<ElectricalIr>,
  svg: string,
  names: readonly string[],
) {
  const doc = parseSvg(svg);
  for (const name of names) {
    const wire = required(ir.wires.find((w) => w.designation === name));
    const row = required(
      [...doc.querySelectorAll("[data-report-row]")].find(
        (r) => r.getAttribute("data-report-row") === wire.uid,
      ),
    );
    for (const col of [6, 7])
      expect(
        row.querySelector(`[data-report-column="${col}"]`)!.textContent!.trim(),
        `${name} col ${col}`,
      ).toMatch(/^\d{2,3}\.[A-D][1-6]$/u);
  }
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "circuit-only packet prints physical boundary terminal locators in wire schedules (%s)",
  async (flow) => {
    const included = new Set(["PS1", "K1", "H1", "W1", "W2", "W3", "W4"]);
    const fixture = await offViewFixture((objects) => {
      for (let i = objects.length - 1; i >= 0; i--)
        if (!included.has(objects[i].designation)) objects.splice(i, 1);
    });
    try {
      const devices = new Map(
        fixture.ir.devices.map((d) => [d.uid, d.designation]),
      );
      const rendered = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "circuit-view-request/0.1",
            title: "Two 24 V loads",
            flow,
            groups: [
              {
                id: "two-loads",
                label: "Two 24 V loads",
                functions: fixture.ir.functions
                  .filter(
                    (f) =>
                      ["K1", "H1"].includes(
                        devices.get(f.id.deviceUid) ?? "",
                      ) && ["coil", "load"].includes(f.kind),
                  )
                  .map((f) => ({
                    device: {
                      by: "designation" as const,
                      value: required(devices.get(f.id.deviceUid)),
                    },
                    key: f.id.functionKey,
                  })),
                conductors: ["W1", "W2", "W3", "W4"],
              },
            ],
          },
          { format: "documentation-view-request/0.1", kind: "wires" },
        ],
      });
      expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
      if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
      const circuitSheet = required(
        rendered.value.sheets.find((s) => s.view.kind === "circuit"),
      );
      assertMarkedPortGroups(circuitSheet.svg);
      const scheduleSheet = required(
        rendered.value.sheets.find((s) => s.view.kind === "wires"),
      );
      assertScheduleLocators(fixture.ir, scheduleSheet.svg, [
        "W1",
        "W2",
        "W3",
        "W4",
      ]);
    } finally {
      await fixture.dispose();
    }
  },
);

function s07BranchCircuitSheets(
  ps1: string,
  k1: string,
  h1: string,
  w1: string,
  w3: string,
) {
  const cardConductors = attr(
    JSON.stringify([
      { kind: "wire", uid: w1 },
      { kind: "wire", uid: w3 },
    ]),
  );
  const s1Body =
    `<circle class="terminal-marker" data-device-uid="${ps1}" data-terminal-key="+" cx="30" cy="30" r="1" fill="white" stroke="#101828"/>` +
    `<g class="off-view-annotation" data-off-view-terminal-id="${attr(JSON.stringify({ deviceUid: ps1, terminalKey: "+" }))}" data-off-view-conductors="${cardConductors}">` +
    `<rect x="2" y="2" width="46" height="18" fill="white" stroke="#101828" stroke-width="0.3"/>` +
    `<text class="off-view-heading" x="4" y="6" font-size="2.5" fill="#101828">Off-view at PS1.+</text>` +
    `<text class="off-view-row" x="4" y="11" font-size="2.5" fill="#101828">W-CTL-010 → K1.A1</text>` +
    `<text class="off-view-row" x="4" y="16" font-size="2.5" fill="#101828">W-CTL-012 → H1.X1</text>` +
    `</g>`;
  const s2Body =
    `<g data-device-uid="${ps1}"><g data-layout-port="n3p0" data-terminal-id="${attr(JSON.stringify([ps1, "+"]))}" data-terminal-key="+">` +
    `<circle data-terminal-marker="true" cx="24" cy="56" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
    `</g></g>` +
    `<path d="M 24 56 H 42" fill="none" stroke="#17212b" stroke-width=".35"/>` +
    `<g data-circuit-conductor="${w1}"><path d="M 42 56 H 45 V 25 H 73" fill="none" stroke="#17212b" stroke-width=".35"/></g>` +
    `<g data-circuit-conductor="${w3}"><path d="M 42 56 H 50 M 66 56 H 73" fill="none" stroke="#17212b" stroke-width=".35"/></g>` +
    `<circle data-circuit-junction="true" data-device-uid="${ps1}" data-terminal-key="+" cx="45" cy="56" r=".55" fill="#17212b"/>` +
    `<text x="53" y="55" font-size="2.5" fill="#17212b">+24V-S2</text>` +
    `<text x="50" y="57.9" font-size="2.5" fill="#17212b">18AWG / blue</text>` +
    `<g data-device-uid="${k1}"><g data-layout-port="n0p0" data-terminal-id="${attr(JSON.stringify([k1, "A1"]))}" data-terminal-key="A1">` +
    `<circle data-terminal-marker="true" cx="73" cy="25" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
    `</g></g>` +
    `<g data-device-uid="${h1}"><g data-layout-port="n1p0" data-terminal-id="${attr(JSON.stringify([h1, "X1"]))}" data-terminal-key="X1">` +
    `<circle data-terminal-marker="true" cx="73" cy="56" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
    `</g></g>` +
    `<rect x="4" y="50.5" width="20" height="11" fill="none" stroke="#17212b"/>` +
    `<rect x="4" y="37" width="38" height="10" fill="#17212b"/>` +
    `<rect x="4" y="67" width="90" height="3" fill="#17212b"/>`;
  return [makeSheet(1, "wiring", s1Body), makeSheet(2, "circuit", s2Body)];
}

it("terminalPeerReferences keeps a co-occurring circuit peer note nearer its owner than foreign conductor runs", async () => {
  const fixture = await offViewFixture((objects) => {
    required(objects.find((o) => o.designation === "W1")).designation =
      "W-CTL-010";
    required(objects.find((o) => o.designation === "W3")).designation =
      "W-CTL-012";
  });
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const ps1 = required(
      fixture.ir.devices.find((d) => d.designation === "PS1"),
    ).uid;
    const k1 = required(
      fixture.ir.devices.find((d) => d.designation === "K1"),
    ).uid;
    const w1 = required(
      fixture.ir.wires.find((w) => w.designation === "W-CTL-010"),
    ).uid;
    const w3 = required(
      fixture.ir.wires.find((w) => w.designation === "W-CTL-012"),
    );
    const h1 = required(fixture.ir.devices.find((d) => d.designation === "H1"));
    const updated = terminalPeerReferences(
      fixture.ir,
      [makeDraft("wiring"), makeDraft("circuit")],
      s07BranchCircuitSheets(ps1, k1, h1.uid, w1, w3.uid),
      page.value,
    );
    const doc = parseSvg(updated[1]!.svg);
    const w3Note = [
      ...doc.querySelectorAll('[data-peer-reference="conductor-peer"]'),
    ].find((el) => {
      const src = JSON.parse(el.getAttribute("data-peer-source") ?? "[]");
      return src[0]?.deviceUid === ps1 && src[1]?.uid === w3.uid;
    });
    expect(w3Note).toBeDefined();
    const region = noteBoundingBox(w3Note!);
    const ownTargets = [
      { x: 23.35, y: 55.35, w: 1.3, h: 1.3 },
      { x: 42, y: 56, w: 8, h: 0 },
      { x: 66, y: 56, w: 7, h: 0 },
    ];
    const foreignConductors = [
      { x: 45, y: 25, w: 0, h: 31 },
      { x: 45, y: 25, w: 28, h: 0 },
    ];
    const ownerGap = Math.min(...ownTargets.map((b) => boxDistance(region, b)));
    const foreignConductorGap = Math.min(
      ...foreignConductors.map((b) => boxDistance(region, b)),
    );
    expect(ownerGap).toBeLessThan(foreignConductorGap);
  } finally {
    await fixture.dispose();
  }
});

it.each([
  [
    "missing marker attribute",
    (ps1: string) =>
      `<g data-device-uid="${ps1}"><g data-layout-port="n0p0" data-terminal-id="${attr(JSON.stringify([ps1, "+"]))}" data-terminal-key="+">` +
      `<circle cx="30" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `</g></g>`,
  ],
  [
    "duplicated marker attribute",
    (ps1: string) =>
      `<g data-device-uid="${ps1}"><g data-layout-port="n0p0" data-terminal-id="${attr(JSON.stringify([ps1, "+"]))}" data-terminal-key="+">` +
      `<circle data-terminal-marker="true" class="unrelated-ring" cx="30" cy="70" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `<circle data-terminal-marker="true" cx="30" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `</g></g>`,
  ],
  [
    "invalid marker attribute value",
    (ps1: string) =>
      `<g data-device-uid="${ps1}"><g data-layout-port="n0p0" data-terminal-id="${attr(JSON.stringify([ps1, "+"]))}" data-terminal-key="+">` +
      `<circle data-terminal-marker="false" cx="30" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `</g></g>`,
  ],
])(
  "wireScheduleLocations requires a unique valid data-terminal-marker on port groups (%s)",
  async (_label, portGroup) => {
    const fixture = await offViewFixture();
    try {
      const page = normalizePaperPage();
      if (!page.ok) throw Error("paper");
      const { ps1, k1, w1 } = findFixtures(fixture.ir);
      const physicalK1 = `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r="1" fill="white" stroke="#101828"/>`;
      const sheet = makeSheet(1, "circuit", portGroup(ps1) + physicalK1);
      const geometry = navigationGeometry(sheet.svg);
      const keys = wireScheduleTerminalKeys(
        fixture.ir,
        makeDraft("circuit"),
        geometry,
      );
      const ps1Key = JSON.stringify([ps1, "+"]);
      expect([...keys.values()].filter((v) => v === ps1Key)).toEqual([]);
      const result = wireScheduleLocations(
        fixture.ir,
        [makeDraft("circuit")],
        [sheet],
        page.value,
      );
      expect(result.get(w1)).toEqual([undefined, "01.B5"]);
    } finally {
      await fixture.dispose();
    }
  },
);

it("wireScheduleLocations preserves non-port-group circles with percentage opacity or compound CSS selectors", async () => {
  const fixture = await offViewFixture();
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const { ps1, k1, w1 } = findFixtures(fixture.ir);
    const key = attr(JSON.stringify([ps1, "+"]));
    const physicalK1 = `<circle class="terminal-marker" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r="1" fill="white" stroke="#101828"/>`;
    for (const body of [
      `<g opacity="50%"><circle data-loop-terminal="${key}" cx="30" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/></g>`,
      `<style>.review-port > .review-marker{stroke:#17212b;stroke-width:.3}</style><g class="review-port"><circle class="review-marker" data-loop-terminal="${key}" cx="30" cy="30" r=".65" fill="white"/></g>`,
      `<g><rect x="28" y="28" width="4" height="4" fill="#17212b"/><circle data-loop-terminal="${key}" cx="30" cy="30" r=".65" fill="none" stroke="white" stroke-width=".3"/></g>`,
    ]) {
      const result = wireScheduleLocations(
        fixture.ir,
        [makeDraft("circuit")],
        [makeSheet(1, "circuit", body + physicalK1)],
        page.value,
      );
      expect(result.get(w1)).toEqual(["01.B2", "01.B5"]);
    }
  } finally {
    await fixture.dispose();
  }
});

it("wireScheduleTerminalKeys keeps a conflicting explicit child identity separate from its parent port group", async () => {
  const fixture = await offViewFixture();
  try {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("paper");
    const { ps1, k1, w1 } = findFixtures(fixture.ir);
    const body =
      `<g data-device-uid="${ps1}"><g data-layout-port="n0p0" data-terminal-id="${attr(JSON.stringify([ps1, "+"]))}" data-terminal-key="+">` +
      `<circle data-terminal-marker="true" data-device-uid="${k1}" data-terminal-key="A1" cx="90" cy="30" r=".65" fill="white" stroke="#17212b" stroke-width=".3"/>` +
      `</g></g>`;
    const result = wireScheduleLocations(
      fixture.ir,
      [makeDraft("circuit")],
      [makeSheet(1, "circuit", body)],
      page.value,
    );
    expect(result.get(w1)).toEqual([undefined, "01.B5"]);
  } finally {
    await fixture.dispose();
  }
});

it.each([
  ["parallel-0.1", "M 20 30 H 40", "M 20 30.1 H 40", true],
  ["parallel-0.06", "M 20 30 H 40", "M 20 30.06 H 40", true],
  ["parallel-0.04-disjoint-ink", "M 20 30 H 40", "M 20 30.04 H 40", true],
  ["coincident-0.04-short", "M 20 30 H 40", "M 24 30 H 24.04", false],
  ["adjacent-perpendicular-0.05", "M 20 30 H 40", "M 30 30 V 30.05", true],
  ["collinear-tail-0.29", "M 20 30 H 40", "M 20 30 H 40.29", true],
  ["collinear-tail-0.31", "M 20 30 H 40", "M 20 30 H 40.31", true],
  ["crossing-diagonal-equal-hulls", "M 20 30 L 40 40", "M 20 40 L 40 30", true],
])(
  "peerRouteIndex.foreignRuns applies exact coincident-ink subtraction (%s)",
  (variant, a, b, expectForeign) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">` +
      `<g data-circuit-conductor="w1"><path d="${a}" fill="none" stroke="#17212b" stroke-width=".025"/></g>` +
      `<g data-circuit-conductor="w2"><path d="${b}" fill="none" stroke="#17212b" stroke-width=".025"/></g>` +
      `</svg>`;
    const foreign = peerRouteIndex(navigationGeometry(svg)).foreignRuns({
      kind: "wire",
      uid: "w1",
    });
    expect(foreign.length > 0).toBe(expectForeign);
    if (variant === "collinear-tail-0.29") {
      const note = { x: 41, y: 31, w: 3, h: 1.8 };
      const ownGap = Math.min(
        ...peerRouteIndex(navigationGeometry(svg))
          .route({ kind: "wire", uid: "w1" })
          .runs.map((r) => boxDistance(note, r)),
      );
      const foreignGap = Math.min(...foreign.map((r) => boxDistance(note, r)));
      expect(foreignGap).toBeLessThan(ownGap - 0.17);
    }
  },
);

it("peerRouteIndex.foreignRuns stops at painted junction dots to remove the s07 PS1.+ tie", () => {
  const routes =
    `<g data-circuit-conductor="w10"><path d="M 72 96 H 75 V 65.25 H 79.675" fill="none" stroke="#17212b" stroke-width=".35"/></g>` +
    `<g data-circuit-conductor="w12"><path d="M 72 96 H 79.675" fill="none" stroke="#17212b" stroke-width=".35"/></g>`;
  const dot = `<circle data-circuit-junction="true" data-device-uid="ps1" data-terminal-key="+" cx="75" cy="96" r=".55" fill="#17212b"/>`;
  const wrap = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 120 120">${body}</svg>`;
  const note = { x: 55.6, y: 99.457, w: 32, h: 1.8 };
  const w12 = { kind: "wire" as const, uid: "w12" };

  const withDot = peerRouteIndex(navigationGeometry(wrap(routes + dot)));
  const ownGap = Math.min(
    ...withDot.route(w12).runs.map((r) => boxDistance(note, r)),
  );
  const foreignGap = Math.min(
    ...withDot.foreignRuns(w12).map((r) => boxDistance(note, r)),
  );
  expect(foreignGap - ownGap).toBeGreaterThan(0.5);

  const withoutDot = peerRouteIndex(navigationGeometry(wrap(routes)));
  const noDotOwnGap = Math.min(
    ...withoutDot.route(w12).runs.map((r) => boxDistance(note, r)),
  );
  const noDotForeignGap = Math.min(
    ...withoutDot.foreignRuns(w12).map((r) => boxDistance(note, r)),
  );
  // Perpendicular half-stroke inflation (0.35 / 2 = 0.175 mm) widens horizontal w12
  // vertically toward the note while w10's vertical branch butt-ends at y = 96.
  expect(noDotForeignGap - noDotOwnGap).toBeCloseTo(0.175, 3);
});
