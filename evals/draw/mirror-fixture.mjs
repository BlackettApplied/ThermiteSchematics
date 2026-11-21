// Synthetic native IR + independently authored ink; no renderer/planner imports.
export const bbox = (x, y, w = 20, h = 2) => ({ x, y, w, h });
export const text = (text, x, y, extra = {}) => ({
  text,
  element: text,
  bbox: bbox(x, y),
  anchor: { x, y },
  painted: true,
  ...extra,
});
export function mirrorFixture() {
  const functions = [
    ["coil", "coil", ["A1", "A2"]],
    ["no", "contact", ["13", "14"]],
    ["nc", "contact", ["21", "22"]],
    ["other", "source", ["+", "-"]],
  ].map(([key, kind, terminals]) => ({
    id: { deviceUid: "k", functionKey: key },
    kind,
    normal_state: key === "nc" ? "closed" : "open",
    terminals: terminals.map((terminalKey) => ({
      deviceUid: "k",
      terminalKey,
    })),
  }));
  const ir = {
    devices: [{ uid: "k", designation: "K1" }],
    functions,
    gangedGroups: [],
    internalRelations: ["no", "nc"].map((key) => ({
      deviceUid: "k",
      verb: "actuates",
      from: functions[0].id,
      to: functions.find((f) => f.id.functionKey === key).id,
    })),
  };
  const request = { views: [{ title: "Coil" }, { title: "Contacts" }] };
  const packet = {
    sheets: [1, 2].map((number) => ({
      number,
      view: { title: request.views[number - 1].title },
    })),
    navigation: {
      occurrences: ["coil", "no"].map((key, i) => ({
        id: "o" + i,
        appearance: "appearance" + i,
        source: { deviceUid: "k", functionKey: key },
        role: "full-function",
        destination: { sheet: i + 1, zone: "D6" },
        provenance: { view: { key: "v" + i, authoredOrder: i } },
      })),
      annotations: ["mirror", "return"].map((role, i) => ({
        id: "a" + i,
        role,
        ownerOccurrence: "o" + i,
        ownerOccurrences: ["o" + i],
      })),
    },
  };
  packet.navigation.seeds = packet.navigation.occurrences.map((o) => ({
    source: o.source,
    appearance: o.appearance,
  }));
  const geometries = [0, 1].map((i) => {
    const f = functions[i],
      scope = "body" + i;
    return {
      texts: [
        ...[1, 2, 3, 4, 5, 6].map((n) =>
          text(String(n), 30 * n, 20, { sheetText: true }),
        ),
        ...["A", "B", "C", "D"].map((n, j) =>
          text(n, 10, 40 * (j + 1), { sheetText: true }),
        ),
      ],
      shapes: [
        {
          element: scope,
          deviceUid: "k",
          functionKey: f.id.functionKey,
          functionScope: scope,
          symbol: "native",
          navigationView: "v" + i,
          bbox: bbox(30, 36, 10, 8),
          stroke: 0.2,
          inkSegments: [],
        },
        {
          element: "frame",
          outline: true,
          deviceUid: "k",
          bbox: bbox(20, 30, 30, 25),
          stroke: 0.2,
        },
      ],
      terminals: f.terminals.map((t, j) => ({
        element: t.terminalKey,
        terminal: t.terminalKey,
        deviceUid: "k",
        functionScope: scope,
        point: { x: 30 + j * 10, y: 40 },
        bbox: bbox(30 + j * 10, 40, 1, 1),
      })),
    };
  });
  const marked = (s, y, extra = {}) =>
    text(s, 30, y, {
      navigationAnnotation: "a0",
      navigationRole: "mirror",
      ...extra,
    });
  geometries[0].texts.push(
    marked("K1", 70),
    marked("NO 13–14 02.A1", 76, {
      mirrorRow: JSON.stringify(functions[1].id),
      mirrorRowScope: "r1",
    }),
    marked("NC 21–22 not drawn", 82, {
      mirrorRow: JSON.stringify(functions[2].id),
      mirrorRowScope: "r2",
    }),
  );
  geometries[1].texts.push(
    text("K1 /01.A1", 30, 70, {
      navigationAnnotation: "a1",
      navigationRole: "return",
    }),
  );
  return { ir, request, packet, geometries };
}
