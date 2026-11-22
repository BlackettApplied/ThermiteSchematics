import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { terminalText, textBounds } from "./checks.mjs";

let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const encode = (s) =>
  Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">${body}</svg>`;
const marker = (uid, fn, terminal, x) =>
  `<g class="symbol function-symbol" data-symbol-id="test" data-device-uid="${uid}" data-function-key="${fn}"><circle class="terminal-marker" id="terminal-${[uid, terminal, "in"].map(encode).join("--")}" data-terminal-key="${terminal}" cx="${x}" cy="20" r=".5" fill="white" stroke="black"/></g>`;
const label = (
  uid,
  fn,
  x,
  value = "A1",
  role = "terminal",
  ownerKind = "port",
) => {
  const port = JSON.stringify([
    "port",
    JSON.stringify(["function", uid, fn]),
    "in",
  ]);
  const owner = ownerKind === "edge" ? JSON.stringify(["wire", "w"]) : port;
  const clip = `clip-${encode(JSON.stringify(["label", ownerKind, owner, role]))}`;
  return `<defs><clipPath id="${clip}"><rect width="200" height="100"/></clipPath></defs><text class="label-${role}" clip-path="url(#${clip})" x="${x}" y="18" font-size="2.5">${value}</text>`;
};

it("resolves a caption from its owned port, even beside a foreign marker", async () => {
  const g = await openSheet(
    page,
    svg(
      marker("owner", "feed", "A1", 100) +
        marker("foreign", "feed", "B1", 15) +
        label("owner", "feed", 15, "B1"),
    ),
  );
  expect(g.texts[0]).toMatchObject({
    labelRole: "terminal",
    deviceUid: "owner",
    terminal: "A1",
  });
  expect(g.texts[0].terminalAppearance).toBeTruthy();
});

it.each([
  ["net", "port"],
  ["terminal", "edge"],
])("rejects the inconsistent %s role on a %s owner", async (role, kind) => {
  const g = await openSheet(
    page,
    svg(
      marker("owner", "feed", "A1", 100) +
        label("owner", "feed", 15, "A1", role, kind),
    ),
  );
  expect(terminalText(g)).toEqual([
    expect.objectContaining({
      kind: "invalid-terminal-caption-ownership",
      reason: "role-owner-mismatch",
    }),
  ]);
  if (kind === "port")
    expect(g.texts[0]).toMatchObject({
      deviceUid: "owner",
      terminal: "A1",
      labelRole: "net",
    });
});

it.each([
  [
    "unknown marker id",
    (body) => body.replace(/id="terminal-[^"]*"/, 'id="unresolved"'),
  ],
  [
    "different port id",
    (body) => body.replace(`${encode("in")}"`, `${encode("out")}"`),
  ],
  [
    "foreign marker identity",
    (body) =>
      body.replace(
        `terminal-${encode("owner")}--`,
        `terminal-${encode("foreign")}--`,
      ),
  ],
  [
    "inconsistent terminal key",
    (body) => body.replace('data-terminal-key="A1"', 'data-terminal-key="B1"'),
  ],
  [
    "missing device owner",
    (body) => body.replace(' data-device-uid="owner"', ""),
  ],
  [
    "missing terminal owner",
    (body) => body.replace(' data-terminal-key="A1"', ""),
  ],
  [
    "duplicate marker declaration",
    (body) => body.replace("</g>", `${body.match(/<circle[^>]*\/>/)[0]}</g>`),
  ],
])("fails closed on %s", async (_name, mutate) => {
  const body = mutate(marker("owner", "feed", "A1", 100));
  const g = await openSheet(page, svg(body + label("owner", "feed", 15)));
  expect(terminalText(g)).toEqual([
    expect.objectContaining({
      kind: "invalid-terminal-caption-ownership",
      reason: "unresolved-terminal-caption-owner",
    }),
  ]);
});

it.each(["absent", "malformed"])(
  "rejects %s caption keys 5 mm apart near a marker",
  async (kind) => {
    const attrs = kind === "malformed" ? ' clip-path="url(#unrecognized)"' : "";
    const captions = [15, 20]
      .map(
        (x) =>
          `<text class="label-terminal" x="${x}" y="18" font-size="2.5"${attrs}>A1</text>`,
      )
      .join("");
    const g = await openSheet(
      page,
      svg(marker("owner", "feed", "A1", 18) + captions),
    );
    expect(terminalText(g)).toHaveLength(2);
    expect(
      terminalText(g).every(
        (f) =>
          f.kind === "invalid-terminal-caption-ownership" &&
          f.reason === "missing-caption-owner-key",
      ),
    ).toBe(true);
  },
);

it.each(["terminal", "net"])(
  "retains the declared %s role when the inner owner key cannot be parsed",
  async (role) => {
    const key = encode(JSON.stringify(["label", "port", "not JSON", role]));
    const clip = `clip-${key}`;
    const g = await openSheet(
      page,
      svg(
        `<defs><clipPath id="${clip}"><rect width="200" height="100"/></clipPath></defs>` +
          // No terminal class may be needed to discover the semantic declaration.
          `<text x="15" y="18" font-size="2.5" clip-path="url(#${clip})">A1</text>`,
      ),
    );
    expect(g.texts[0]).toMatchObject({
      labelRole: role,
      labelOwnerKind: "port",
    });
    expect(terminalText(g)).toEqual([
      expect.objectContaining({
        kind: "invalid-terminal-caption-ownership",
        reason: "missing-caption-owner-key",
      }),
    ]);
  },
);

it("keeps equal-spelled net labels semantic and still rejects real overlap", async () => {
  const netClip = `clip-${encode(JSON.stringify(["label", "edge", JSON.stringify(["wire", "w"]), "net"]))}`;
  const net = (x) =>
    `<defs><clipPath id="${netClip}"><rect width="200" height="100"/></clipPath></defs><text class="label-net" clip-path="url(#${netClip})" x="${x}" y="18" font-size="2.5">A1</text>`;
  const body = marker("owner", "feed", "A1", 100) + label("owner", "feed", 15);
  const separate = await openSheet(page, svg(body + net(25)));
  expect(
    separate.texts.find((t) => t.labelRole === "net").terminal,
  ).toBeUndefined();
  expect(terminalText(separate)).toEqual([]);
  const overlapping = await openSheet(page, svg(body + net(15)));
  expect(terminalText(overlapping)[0].kind).toBe(
    "duplicate-or-overlapping-terminal-text",
  );
  expect(textBounds(overlapping)[0].kind).toBe("text-text-overlap");
});

it("rejects duplicate captions on one body and retains separate drawn appearances", async () => {
  const body = marker("owner", "feed", "A1", 100) + label("owner", "feed", 15);
  const duplicate = await openSheet(
    page,
    svg(body + label("owner", "feed", 45)),
  );
  expect(terminalText(duplicate)).toHaveLength(1);
  const split = await openSheet(
    page,
    svg(
      body + marker("owner", "other", "A1", 140) + label("owner", "other", 25),
    ),
  );
  expect(split.texts[0].terminalAppearance).not.toBe(
    split.texts[1].terminalAppearance,
  );
  expect(terminalText(split)).toEqual([]);
});

it("V5 resolves net repetition through its own wire and exact landing appearance", async () => {
  const port = JSON.stringify([
    "port",
    JSON.stringify(["function", "owner", "feed"]),
    "in",
  ]);
  const wire = (attrs = "") => {
    attrs = attrs.replace(
      /(data-[\w-]+-key)='([^']+)'/g,
      (_match, name, key) =>
        `${name}='${name === "data-edge-key" ? "edge" : "port"}-${encode(key)}'`,
    );
    return `<path data-wire-uid="w" data-source-device-uid="owner" data-source-terminal-key="A1" data-target-device-uid="remote" data-target-terminal-key="B1" ${attrs} d="M 100 20 H 180" stroke="black" fill="none"/>`;
  };
  const body =
    marker("owner", "feed", "A1", 100) +
    label("owner", "feed", 15) +
    label("owner", "feed", 45, "A1", "net", "edge");
  for (const attrs of [
    `data-route-source-port-key='${port}' data-edge-key='["wire","w"]'`,
  ]) {
    const g = await openSheet(page, svg(body + wire(attrs)));
    expect(terminalText(g)).toEqual([
      expect.objectContaining({
        kind: "net-label-repeats-terminal-caption",
        text: "A1",
      }),
    ]);
  }
  expect(terminalText(await openSheet(page, svg(body + wire())))).toEqual([]);
  const split = body + marker("owner", "other", "A1", 140);
  expect(terminalText(await openSheet(page, svg(split + wire())))).toEqual([]);
  expect(
    terminalText(
      await openSheet(
        page,
        svg(
          split +
            wire(
              `data-route-source-port-key='${port.replace("feed", "other")}'`,
            ),
        ),
      ),
    ),
  ).toEqual([
    expect.objectContaining({ kind: "net-label-source-geometry-mismatch" }),
  ]);
  for (const attrs of [
    `data-route-source-port-key='malformed'`,
    `data-route-source-port-key='${port}' data-edge-key='["wire","foreign"]'`,
  ])
    expect(
      terminalText(await openSheet(page, svg(split + wire(attrs)))),
    ).toEqual([]);
  expect(
    terminalText(
      await openSheet(
        page,
        svg(split + wire(`data-route-source-port-key='${port}'`)),
      ),
    )[0].kind,
  ).toBe("net-label-repeats-terminal-caption");
});

it.each([
  ["L+", "+"],
  ["M", "-"],
])(
  "V5 keeps a printed %s name at the source and kills far-end suppression",
  async (name, sourceCaption) => {
    const port = (uid, fn) =>
      `port-${encode(JSON.stringify(["port", JSON.stringify(["function", uid, fn]), "in"]))}`;
    const wire = `<path data-wire-uid="w" data-potential-name="${name}" data-edge-key="edge-${encode('["wire","w"]')}" data-route-source-port-key="${port("PS1", "supply")}" data-route-target-port-key="${port("PLC1", "load")}" data-source-device-uid="PS1" data-source-terminal-key="${sourceCaption}" data-target-device-uid="PLC1" data-target-terminal-key="${name}" d="M 15 20 H 180" stroke="black" fill="none"/>`;
    const captions =
      marker("PS1", "supply", sourceCaption, 15) +
      label("PS1", "supply", 15, sourceCaption) +
      marker("PLC1", "load", name, 180) +
      label("PLC1", "load", 175, name);
    const net = label("PS1", "supply", 40, name, "net", "edge");
    expect(
      terminalText(await openSheet(page, svg(captions + wire + net))),
    ).toEqual([]);
    // Exact mutation used by the old renderer: retain only the semantic empty
    // text/clip placeholder, while the matching far caption stays printed.
    const missing = net.replace(`>${name}</text>`, "></text>");
    const g = await openSheet(page, svg(captions + wire + missing));
    expect(g.omittedNetLabels).toHaveLength(1);
    expect(terminalText(g)).toEqual([
      expect.objectContaining({
        kind: "net-label-suppressed-without-source-caption",
        text: name,
      }),
    ]);
    // A same-end, same-body printed caption can replace the empty name.
    const sameEnd = captions.replace(
      `>${sourceCaption}</text>`,
      `>${name}</text>`,
    );
    expect(
      terminalText(await openSheet(page, svg(sameEnd + wire + missing))),
    ).toEqual([]);
  },
);
