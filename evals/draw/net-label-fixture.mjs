export const box = (x) => ({ x, y: 17, w: 8, h: 3 });
export function netLabelFixture() {
  const caption = {
    element: "caption",
    text: "L1",
    bbox: box(10),
    labelRole: "terminal",
    labelOwnerKind: "port",
    labelOwnerKey: ["port", '["function","a","feed"]', "in"],
    deviceUid: "a",
    terminal: "L1",
    terminalAppearance: "body-a",
    appearanceScope: "drawing",
  };
  const label = {
    element: "net",
    text: "L1",
    bbox: box(30),
    labelRole: "net",
    labelOwnerKind: "edge",
    labelOwnerKey: ["wire", "w"],
    appearanceScope: "drawing",
  };
  const route = {
    element: "route",
    cls: "",
    stroke: 0.35,
    fill: "none",
    dash: "none",
    bbox: { x: 10, y: 20, w: 180, h: 0 },
    conductor: true,
    edgeOwnerKey: ["wire", "w"],
    appearanceScope: "drawing",
    potentialName: "L1",
    points: [
      { x: 10, y: 20 },
      { x: 190, y: 20 },
    ],
    landingOwners: [
      {
        landingEnd: "source",
        deviceUid: "a",
        terminal: "L1",
        terminalAppearance: "body-a",
        anchorElement: "marker-a",
      },
    ],
    ownedLandings: [
      {
        end: "source",
        endpoint: { x: 10, y: 20 },
        anchor: { x: 10, y: 20 },
        deviceUid: "a",
        terminal: "L1",
        anchorElement: "marker-a",
      },
    ],
  };
  const g = {
    width: 240,
    height: 220,
    texts: [caption, label],
    shapes: [route],
    terminals: [],
    devices: [],
    catalogs: [],
    reportRows: [],
    omittedNetLabels: [],
  };
  return { g, caption, label, route };
}
const hex = (s) =>
  Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
const port = (uid) =>
  `port-${hex(JSON.stringify(["port", JSON.stringify(["function", uid, "feed"]), "in"]))}`;
const marker = (uid, x) =>
  `<g class="symbol function-symbol" data-symbol-id="test" data-device-uid="${uid}" data-function-key="feed"><circle class="terminal-marker" id="terminal-${[uid, "1", "in"].map(hex).join("--")}" data-terminal-key="1" cx="${x}" cy="20" r=".5" fill="white" stroke="black"/></g>`;
export function netDrawing({
  far = false,
  falseSource = false,
  tspan = false,
  repeat = false,
} = {}) {
  const clip = `clip-${hex(JSON.stringify(["label", "edge", '["wire","w"]', "net"]))}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">${marker("a", 10)}${marker("b", 190)}<path data-wire-uid="w" data-source-device-uid="${falseSource ? "b" : "a"}" data-source-terminal-key="1" data-target-device-uid="${falseSource ? "a" : "b"}" data-target-terminal-key="1" data-route-source-port-key="${port(falseSource ? "b" : "a")}" data-route-target-port-key="${port(falseSource ? "a" : "b")}" data-edge-key="edge-${hex('["wire","w"]')}" d="M10 20 H190" stroke="black" fill="none"/><defs><clipPath id="${clip}"><rect width="200" height="100"/></clipPath></defs><text class="label-net" clip-path="url(#${clip})" x="${far ? 170 : 30}" y="18" font-size="2.7">${tspan ? "<tspan>N1</tspan>" : "N1"}</text>${repeat ? sourceCaption() : ""}</svg>`;
}

function sourceCaption() {
  const clip = `clip-${hex(JSON.stringify(["label", "port", JSON.stringify(["port", JSON.stringify(["function", "a", "feed"]), "in"]), "terminal"]))}`;
  return `<defs><clipPath id="${clip}"><rect width="200" height="100"/></clipPath></defs><text class="label-terminal" clip-path="url(#${clip})" x="2" y="16" font-size="2.7">N1</text>`;
}
