import { expect, it } from "vitest";
import { functionKeys, internalVocabulary } from "./checks.mjs";
const uid = "device",
  key = "arbitrary.nested_938";
const ir = {
  devices: [
    {
      uid,
      designation: "K1",
      typeId: "core:hidden_type",
      io: { channels: { [key]: { address: "Q0.0" } } },
    },
  ],
  deviceTypes: [
    {
      id: "core:hidden_type",
      description: "coil core: user-authored prose",
      ports: { hidden_port: { connector: "RJ45", medium: "ethernet" } },
    },
  ],
  functions: [
    {
      id: { deviceUid: uid, functionKey: key },
      kind: "contact",
      normal_state: "open",
      terminals: [
        { deviceUid: uid, terminalKey: "13" },
        { deviceUid: uid, terminalKey: "14" },
      ],
    },
  ],
  terminals: [],
  relations: [],
  cables: [],
  cableTypes: [],
};
const text = (text, attrs = {}) => ({ element: "t", text, ...attrs });
const measure = (texts, context = {}) => functionKeys({ texts }, ir, context);
const row = JSON.stringify([uid, [key]]),
  context = {
    sheet: { view: { kind: "references" } },
    packet: {
      sheets: [{ references: [{ deviceUid: uid, functions: [key] }] }],
    },
  };
it("measures combined reference cells from owned functions, independent of key vocabulary", () => {
  expect(
    measure([text("NO contact 13–14", { row, columnIndex: 1 })], context),
  ).toEqual([]);
  expect(measure([text(key, { row, columnIndex: 1 })], context)).toMatchObject([
    { mechanism: "function-reference", expected: "NO contact 13–14" },
  ]);
  for (const marker of [
    { authoredText: "request-note" },
    { deviceUid: uid },
    { tagField: "description", tagOwnerUid: uid, tagOwnershipValid: true },
  ])
    expect(
      measure([text(key, { row, columnIndex: 1, ...marker })], context),
    ).toHaveLength(1);
});
it("compares complete cell content across font runs and wrapping", () => {
  expect(
    measure(
      [
        text("NO contact", { row, columnIndex: 1 }),
        text("13–14", { row, columnIndex: 1 }),
      ],
      context,
    ),
  ).toEqual([]);
  expect(
    measure(
      [
        text("prefix", { row, columnIndex: 1 }),
        text(key.slice(0, 8), { row, columnIndex: 1 }),
        text(key.slice(8), { row, columnIndex: 1 }),
      ],
      context,
    ),
  ).toHaveLength(1);
});
it("missing, unknown and forged note provenance grants no exemption", () => {
  const note = `Nested note: K1.${key}, K1.${key}.`;
  for (const attrs of [
    {},
    { authoredText: "request-note" },
    { row: "forged", columnIndex: 1 },
    { deviceUid: "foreign", tagField: "description" },
  ])
    expect(measure([text(note, attrs)])).toHaveLength(2);
});
it("literal semantic words and type-shaped authored descriptions remain source facts", () => {
  expect(
    measure([
      text("coil core: user-authored prose", {
        deviceUid: uid,
        tagOwnerUid: uid,
        tagField: "description",
        tagOwnershipValid: true,
      }),
    ]),
  ).toEqual([]);
  expect(
    internalVocabulary(
      {
        texts: [
          text("coil core: user-authored prose", {
            deviceUid: uid,
            tagOwnerUid: uid,
            tagField: "description",
            tagOwnershipValid: true,
          }),
        ],
      },
      ir,
    ),
  ).toEqual([]);
  const fn = {
    ...ir.functions[0],
    id: { deviceUid: uid, functionKey: "coil" },
    kind: "coil",
  };
  expect(
    functionKeys(
      {
        texts: [
          text("coil", {
            deviceUid: uid,
            functionKey: "coil",
            role: "label-function",
          }),
        ],
      },
      { ...ir, functions: [fn] },
    ),
  ).toEqual([]);
  expect(
    functionKeys(
      {
        texts: [
          text("coil", {
            row: JSON.stringify([uid, ["coil"]]),
            columnIndex: 1,
          }),
        ],
      },
      { ...ir, functions: [fn] },
      { sheet: { view: { kind: "references" } } },
    ),
  ).toHaveLength(1);
});
it("checks authored I/O identity rather than a selector and detects changed addresses", () => {
  const data = {
      ...ir,
      functions: [{ ...ir.functions[0], kind: "channel", direction: "output" }],
    },
    c = { sheet: { view: { kind: "io" } } },
    row = JSON.stringify([uid, key]);
  expect(
    functionKeys({ texts: [text("Q0.0", { row, columnIndex: 1 })] }, data, c),
  ).toEqual([]);
  for (const value of [key, "Q1.0", "DO 9"])
    expect(
      functionKeys({ texts: [text(value, { row, columnIndex: 1 })] }, data, c),
    ).toHaveLength(1);
});
it("checks complete I/O directions only for their native channel rows", () => {
  const channel = (functionKey, direction) => ({
    ...ir.functions[0],
    id: { deviceUid: uid, functionKey },
    kind: "channel",
    direction,
  });
  const data = {
    ...ir,
    functions: [
      channel("output", "output"),
      channel(key, "input"),
      { ...ir.functions[0], id: { deviceUid: uid, functionKey: "contact" } },
    ],
  };
  const inspect = (value, functionKey, columnIndex = 2, kind = "io") =>
    functionKeys(
      {
        texts: [
          text(value, { row: JSON.stringify([uid, functionKey]), columnIndex }),
        ],
      },
      data,
      { sheet: { view: { kind } } },
    );
  expect(inspect("output", "output")).toEqual([]);
  expect(inspect("input", key)).toEqual([]);
  for (const value of ["input", "output output", "output internal"])
    expect(inspect(value, "output")).toMatchObject([
      { mechanism: "io-direction", expected: "output" },
    ]);
  expect(inspect("output", key)).toMatchObject([
    { mechanism: "io-direction", expected: "input" },
  ]);
  expect(inspect("output", "output", 1)).toMatchObject([
    { mechanism: "io-channel" },
  ]);
  expect(inspect("output", "output", 3)).toMatchObject([{ key: "output" }]);
  expect(inspect("output", "contact")).toMatchObject([{ key: "output" }]);
  expect(inspect("output", "missing")).toMatchObject([{ key: "output" }]);
  expect(inspect("output", "output", 2, "bom")).toMatchObject([
    { key: "output" },
  ]);
});

it("checks communication ownership in drawings and schedules without inventing connectors", () => {
  expect(
    measure([
      text("hidden_port", { deviceUid: uid, communicationPort: "hidden_port" }),
    ]),
  ).toEqual([]);
  expect(
    measure([
      text("RJ45", { deviceUid: uid, communicationPort: "hidden_port" }),
    ]),
  ).toHaveLength(1);
  const row = JSON.stringify([uid, "hidden_port"]),
    c = { sheet: { view: { kind: "network" } } };
  expect(
    measure([text("K1: hidden_port", { row, columnIndex: 2 })], c),
  ).toEqual([]);
  expect(
    measure([text("K1.hidden_port", { row, columnIndex: 2 })], c),
  ).toHaveLength(1);
});
it.each(["drawing", "schedule"])(
  "requires the authored key and description in a described port %s",
  (view) => {
    const data = structuredClone(ir);
    data.deviceTypes[0].ports.hidden_port.description = "Ethernet uplink";
    const drawing = view === "drawing";
    const attrs = drawing
      ? { deviceUid: uid, communicationPort: "hidden_port" }
      : { row: JSON.stringify([uid, "hidden_port"]), columnIndex: 2 };
    const c = {
      sheet: { view: { kind: drawing ? "communication" : "network" } },
    };
    const expected = drawing
      ? "hidden_port — Ethernet uplink"
      : "K1: hidden_port — Ethernet uplink";
    const inspect = (value) =>
      functionKeys({ texts: [text(value, attrs)] }, data, c);
    expect(inspect(expected)).toEqual([]);
    for (const value of drawing
      ? ["Ethernet uplink", "hidden_port", "K1.hidden_port — Ethernet uplink"]
      : [
          "K1: Ethernet uplink",
          "K1: hidden_port",
          "K1.hidden_port — Ethernet uplink",
        ])
      expect(inspect(value)).toMatchObject([
        {
          mechanism: drawing
            ? "communication-caption"
            : "communication-schedule",
          text: value,
          expected,
        },
      ]);
  },
);
it.each([
  {
    names: ["+", "-", "S"],
    reference: "Other + / - / S",
    wrongReference: "Other +–-–S",
  },
  {
    names: ["3", "1", "2"],
    reference: "Other 3 / 1 / 2",
    wrongReference: "Other 3–1–2",
  },
  {
    names: ["+", "-"],
    reference: "Output channel + / -",
    channel: "+ / -",
    wrongReference: "Output channel +–-",
    wrongChannel: "+–-",
  },
])(
  "checks authored terminal set $names in reference and I/O cells",
  (entry) => {
    const data = {
      ...ir,
      devices: [{ ...ir.devices[0], io: undefined }],
      functions: [
        {
          id: { deviceUid: uid, functionKey: key },
          ...(entry.channel
            ? { kind: "channel", direction: "output" }
            : { kind: "other" }),
          terminals: entry.names.map((terminalKey) => ({
            deviceUid: uid,
            terminalKey,
          })),
        },
      ],
    };
    const cases = [
      [
        context,
        row,
        entry.reference,
        entry.wrongReference,
        "function-reference",
      ],
    ];
    // Authored channels allow at most two bindings; exercise the I/O fallback
    // with the valid polarity pair, and larger sets on an "other" function.
    if (entry.channel)
      cases.push([
        { sheet: { view: { kind: "io" } } },
        JSON.stringify([uid, key]),
        entry.channel,
        entry.wrongChannel,
        "io-channel",
      ]);
    for (const [c, cellRow, expected, wrong, mechanism] of cases) {
      const inspect = (value) =>
        functionKeys(
          { texts: [text(value, { row: cellRow, columnIndex: 1 })] },
          data,
          c,
        );
      expect(inspect(expected)).toEqual([]);
      expect(inspect(wrong)).toMatchObject([
        { mechanism, text: wrong, expected },
      ]);
    }
  },
);
it("measures schema vocabulary and latent type-ID fallbacks separately", () => {
  const columnIndex = 5,
    row = JSON.stringify(["core:hidden_type", "", null]);
  const data = {
    ...ir,
    deviceTypes: [{ ...ir.deviceTypes[0], description: undefined }],
  };
  expect(
    internalVocabulary(
      { texts: [text("core:hidden_type", { row, columnIndex })] },
      data,
      { sheet: { view: { kind: "bom" } } },
    ),
  ).toMatchObject([{ mechanism: "type-description-fallback" }]);
  expect(
    internalVocabulary({ texts: [text("Rows follow terminalOrder.")] }, ir, {
      sheet: { view: { kind: "terminals" } },
    }),
  ).toMatchObject([{ mechanism: "schema-identifier" }]);
});
it("reconciles adjacent independently positioned font runs before key matching", () => {
  const texts = [
    text("K1.", { anchor: { x: 5, y: 10 }, bbox: { x: 5, y: 8, w: 4, h: 2 } }),
    text(key, {
      element: "font-run",
      anchor: { x: 9, y: 10 },
      bbox: { x: 9, y: 8, w: 20, h: 2 },
    }),
  ];
  expect(measure(texts)).toMatchObject([{ key: `K1.${key}` }]);
});
it("requires a validated description field and refuses copied real-note provenance", () => {
  const literal = `K1.${key}`;
  const data = { ...ir, devices: [{ ...ir.devices[0], description: literal }] };
  for (const attrs of [
    { deviceUid: uid },
    {
      deviceUid: uid,
      tagField: "description",
      tagOwnerUid: uid,
      tagOwnershipValid: false,
    },
  ])
    expect(functionKeys({ texts: [text(literal, attrs)] }, data)).toHaveLength(
      1,
    );
  const c = {
    sheet: { view: { title: "Authored", kind: "signal-loop" } },
    request: {
      views: [
        {
          title: "Authored",
          format: "signal-loop-view-request/0.1",
          notes: [literal],
        },
      ],
    },
  };
  const legitimate = text(literal, { authoredText: "request-note" });
  expect(measure([legitimate], c)).toEqual([]);
  expect(
    measure([legitimate, { ...legitimate, element: "forged" }], c),
  ).toHaveLength(2);
  expect(
    measure([
      text("hidden_port", {
        deviceUid: "foreign",
        communicationPort: "hidden_port",
      }),
    ]),
  ).toHaveLength(1);
});
it("reconciles the owned terminal-order note, including unknown substituted schema identifiers", () => {
  const c = { sheet: { view: { kind: "terminals" } } },
    note =
      "Terminals follow the authored order where specified. Location groups do not assert installation sides.";
  expect(
    internalVocabulary({ texts: [text(note, { reportNote: "1" })] }, ir, c),
  ).toEqual([]);
  expect(
    internalVocabulary(
      { texts: [text("Rows follow objectRefByUid.", { reportNote: "1" })] },
      ir,
      c,
    ),
  ).toMatchObject([{ mechanism: "schema-identifier", expected: note }]);
  expect(
    internalVocabulary({ texts: [text("Rows follow objectRefByUid.")] }, ir, c),
  ).toMatchObject([{ mechanism: "missing-report-note-provenance" }]);
});
it("does not let matching query output certify generated report columns", () => {
  for (const [kind, column, value, internal] of [
    ["wires", 4, `K1.${key}`, false],
    ["io-ports", 7, "K1.hidden_port", false],
    ["assemblies", 4, "core:hidden_type", true],
  ]) {
    const c = {
      sheet: { view: { kind } },
      tables: [
        {
          kind,
          rows: [
            {
              key: "forged",
              cells: Array.from({ length: column + 1 }, (_, i) =>
                i === column ? value : "",
              ),
            },
          ],
        },
      ],
    };
    const g = { texts: [text(value, { row: "forged", columnIndex: column })] };
    expect(
      (internal ? internalVocabulary : functionKeys)(g, ir, c),
    ).toHaveLength(1);
  }
  const data = structuredClone(ir);
  data.devices[0].io.channels[key].signal = `coil core: K1.${key}`;
  expect(
    functionKeys(
      {
        texts: [
          text(`coil core: K1.${key}`, {
            row: JSON.stringify([uid, key]),
            columnIndex: 5,
          }),
        ],
      },
      data,
      { sheet: { view: { kind: "io" } } },
    ),
  ).toEqual([]);
});
it("checks circuit heading content as well as the native group identity", () => {
  const c = {
    sheet: { view: { kind: "circuit", title: "Authored" } },
    request: {
      views: [{ title: "Authored", groups: [{ id: "g", label: `K1.${key}` }] }],
    },
  };
  expect(measure([text(`K1.${key}`, { circuitHeading: "g" })], c)).toEqual([]);
  const forged = {
    ...c,
    request: {
      views: [
        { title: "Authored", groups: [{ id: "g", label: "Check wiring" }] },
      ],
    },
  };
  expect(
    measure([text(`K1.${key}`, { circuitHeading: "g" })], forged),
  ).toHaveLength(1);
});
it("cross-checks native reference functions against actual packet appearances", () => {
  const foreign = { ...context, packet: { sheets: [{ references: [] }] } };
  expect(
    measure([text("NO contact 13–14", { row, columnIndex: 1 })], foreign),
  ).toMatchObject([{ mechanism: "function-reference-owner" }]);
});
it("recovers unmarked captions from native routed port ownership", () => {
  const data = {
    ...ir,
    relations: [
      {
        uid: "link",
        fromDeviceUid: uid,
        toDeviceUid: uid,
        connection: { fromPort: "hidden_port", toPort: "hidden_port" },
      },
    ],
  };
  const g = {
    communicationRoutes: [{ link: "link", source: "p1", target: "p2" }],
    communicationCaptions: [
      { layoutPort: "p1", deviceUid: uid, elements: ["t"] },
    ],
    texts: [text("hidden_port", { deviceUid: uid })],
  };
  const c = { sheet: { view: { kind: "communication" } } };
  expect(functionKeys(g, data, c)).toEqual([]);
  for (const value of ["RJ45", "K1.hidden_port", key])
    expect(
      functionKeys({ ...g, texts: [text(value, { deviceUid: uid })] }, data, c),
    ).toHaveLength(1);
  expect(functionKeys({ ...g, communicationRoutes: [] }, data, c)).toHaveLength(
    1,
  );
});
it("allows an owned bare port marking while still rejecting its qualified selector", () => {
  expect(measure([text("hidden_port", { deviceUid: uid })])).toEqual([]);
  expect(measure([text("K1.hidden_port", { deviceUid: uid })])).toHaveLength(1);
});
it("resolves device-only references and never exempts a reference without a packet", () => {
  const row = JSON.stringify([uid, []]),
    c = {
      sheet: { view: { kind: "references" } },
      packet: { sheets: [{ references: [{ deviceUid: uid, functions: [] }] }] },
    };
  expect(
    measure([text("Terminal / schedule", { row, columnIndex: 1 })], c),
  ).toEqual([]);
  expect(
    measure([text("Device / terminal / port", { row, columnIndex: 1 })], {
      ...c,
      request: { references: { appearances: "drawings" } },
    }),
  ).toEqual([]);
  expect(
    measure(
      [
        text("NO contact 13–14", {
          row: JSON.stringify([uid, [key]]),
          columnIndex: 1,
        }),
      ],
      { sheet: c.sheet },
    ),
  ).toHaveLength(1);
  expect(
    measure([text("Drawing index", { row: "1", columnIndex: 1 })], {
      sheet: { view: { kind: "index" } },
    }),
  ).toEqual([]);
});
