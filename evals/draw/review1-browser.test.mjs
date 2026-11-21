import { beforeAll, afterAll, it, expect } from "vitest";
import { launchBrowser } from "../../packages/cli/test/helpers/pdf-raster.ts";
import { drawingContextOptions, openSheet } from "./browser.mjs";
import { polarityFindings, markFindings } from "./symbol-fidelity.mjs";
import { loopRouteFindings, attachmentAudit } from "./routing-hygiene.mjs";
import { authoredCircuitShapes } from "./issued-circuit-coverage.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launchBrowser();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${body}</svg>`;
const contact = (
  extra = "",
  link = 'stroke-dasharray="1.5 1"',
  slash = 'x1="2" y1="10" x2="10" y2="2"',
) =>
  svg(
    `<g data-device-uid="d" data-circuit-functions='[{"deviceUid":"d","functionKey":"c"}]'><g data-function-key="c"><g data-circuit-mark="pressure-nc" stroke="black" stroke-width=".32" fill="none" transform="translate(30 30)"><line data-circuit-role="contact-moving" x1="4" y1="3" x2="4" y2="9"/><line data-circuit-role="contact-fixed" x1="8" y1="3" x2="8" y2="9"/><line data-circuit-role="contact-state" ${slash}/><line data-circuit-role="operating-link" x1="4" y1="-4" x2="4" y2="2" ${link}/>${extra}</g></g></g>`,
  );
const ir = {
  devices: [{ uid: "d", typeId: "type" }],
  deviceTypes: [{ id: "type", symbol: "thermite:pressure-switch" }],
  functions: [
    {
      id: { deviceUid: "d", functionKey: "c" },
      kind: "contact",
      normal_state: "closed",
      terminals: [
        { deviceUid: "d", terminalKey: "1" },
        { deviceUid: "d", terminalKey: "2" },
      ],
    },
  ],
  terminals: [],
};
it("issued circuit ink resolves measured group locators to authored native functions, not planner kind", async () => {
  const request = {
    views: [
      {
        format: "circuit-view-request/0.1",
        title: "Circuit",
        groups: [
          {
            id: "main",
            functions: [{ device: { by: "uid", value: "d" }, key: "c" }],
          },
        ],
      },
    ],
  };
  const content = contact().replace(
    '<g data-device-uid="d"',
    '<g data-circuit-group="main" data-device-uid="d"',
  );
  const g = await openSheet(page, content);
  const sheet = { view: { title: "Circuit", kind: "power" } };
  expect(authoredCircuitShapes(sheet, g, ir, request).length).toBeGreaterThan(
    0,
  );
  for (const bad of [
    content.replace(
      'data-circuit-group="main"',
      'data-circuit-group="foreign"',
    ),
    content.replace('data-device-uid="d"', 'data-device-uid="foreign"'),
    content.replace('data-function-key="c"', 'data-function-key="foreign"'),
  ])
    expect(
      authoredCircuitShapes(
        { view: { title: "Circuit", kind: "circuit" } },
        await openSheet(page, bad),
        ir,
        request,
      ),
    ).toEqual([]);
});
it("actual dash intervals merge duplicated solid ink; hidden/overpainted dashes fail", async () => {
  const g = await openSheet(page, contact());
  expect(markFindings(g, ir)).toEqual([]);
  for (const extra of [
    '<line x1="4" y1="-4" x2="4" y2="2"/>',
    '<rect x="3" y="-4" width="2" height="7" fill="white" stroke="none"/>',
  ])
    expect(
      markFindings(await openSheet(page, contact(extra)), ir).some(
        (f) => f.kind === "operating-link-without-visible-dashes",
      ),
    ).toBe(true);
  expect(
    markFindings(await openSheet(page, contact("", 'opacity="0"')), ir).some(
      (f) => f.kind === "operating-link-without-visible-dashes",
    ),
  ).toBe(true);
  expect(
    markFindings(
      await openSheet(
        page,
        contact("", 'stroke-dasharray="1.5 1"', 'x1="2" y1="8" x2="6" y2="4"'),
      ),
      ir,
    ).some((f) => f.kind === "closed-contact-slash-misses-bars"),
  ).toBe(true);
});
it("actual loop paths are routes, assembly bars excluded, with stripped metadata disclosed", async () => {
  const body =
    '<g data-layout-source-port="a" data-layout-target-port="b" data-loop-conductor="w"><path d="M10 20 H20 V21.857 H30" stroke="black" stroke-width=".32" fill="none"/></g>';
  const native = { wires: [{ uid: "w" }] };
  expect(
    loopRouteFindings(await openSheet(page, svg(body)), native).some(
      (f) => f.kind === "jog-under-3mm",
    ),
  ).toBe(true);
  expect(
    loopRouteFindings(
      await openSheet(
        page,
        svg(body.replace('data-loop-conductor="w"', 'data-cable-assembly="a"')),
      ),
      native,
    ),
  ).toEqual([]);
});
it("actual polarity uses native port role and geometry, not orientation flags", async () => {
  const body = `<g class="device-group" data-device-uid="d" data-function-key="s" data-symbol-id="power-source-dc"><line x1="14" y1="13" x2="16" y2="13" stroke="black" data-symbol-qualifier="polarity" data-polarity="positive" data-symbol-port-id="positive"/><line x1="15" y1="12" x2="15" y2="14" stroke="black" data-symbol-qualifier="polarity" data-polarity="positive" data-symbol-port-id="positive"/><line x1="14" y1="27" x2="16" y2="27" stroke="black" data-symbol-qualifier="polarity" data-polarity="negative" data-symbol-port-id="return"/><circle class="terminal-marker" cx="10" cy="10" r=".5" data-terminal-key="+" data-symbol-port-id="positive"/><circle class="terminal-marker" cx="10" cy="30" r=".5" data-terminal-key="-" data-symbol-port-id="return"/></g>`;
  const source = {
    terminals: [
      { id: { deviceUid: "d", terminalKey: "+" }, role: "dc_positive_output" },
      { id: { deviceUid: "d", terminalKey: "-" }, role: "dc_return_output" },
    ],
  };
  expect(polarityFindings(await openSheet(page, svg(body)), source)).toEqual(
    [],
  );
  expect(
    polarityFindings(
      await openSheet(
        page,
        svg(
          body
            .replaceAll(' data-symbol-qualifier="polarity"', "")
            .replace(' data-symbol-id="power-source-dc"', ""),
        ),
      ),
      source,
    ).some((f) => f.kind === "polarity-primitive-not-upright"),
  ).toBe(true);
  expect(
    polarityFindings(
      await openSheet(
        page,
        svg(
          body.replace(
            'x1="14" y1="27" x2="16" y2="27"',
            'x1="15" y1="26" x2="15" y2="28"',
          ),
        ),
      ),
      source,
    ).some((f) => f.kind === "polarity-primitive-not-upright"),
  ).toBe(true);
  expect(
    polarityFindings(
      await openSheet(
        page,
        svg(
          body.replace(
            'data-symbol-port-id="return"/><circle',
            'data-symbol-port-id="positive"/><circle',
          ),
        ),
      ),
      source,
    ).some((f) => f.kind === "polarity-not-adjacent-own-port"),
  ).toBe(true);
});

it("stripping a loop marker retains source-owned route measurement", async () => {
  const body = `<g data-layout-source-port="a" data-layout-target-port="b" data-terminal-ends='[{"deviceUid":"d","terminalKey":"1"},{"deviceUid":"d","terminalKey":"2"}]' data-net-id="net"><path d="M10 20 H20 V21.857 H30" stroke="black" stroke-width=".32" fill="none"/></g>`;
  const native = {
    wires: [
      {
        uid: "w",
        endpoints: [
          { terminal: { deviceUid: "d", terminalKey: "1" } },
          { terminal: { deviceUid: "d", terminalKey: "2" } },
        ],
      },
    ],
  };
  expect(
    loopRouteFindings(await openSheet(page, svg(body)), native).some(
      (f) => f.kind === "jog-under-3mm",
    ),
  ).toBe(true);
});

it("stripped and forged attachment ownership cannot erase dark ray ink", async () => {
  const source = { terminals: [{ id: { deviceUid: "d", terminalKey: "1" } }] };
  const body = `<g data-device-uid="d"><g data-attachment-from='{"x":10,"y":10}' data-attachment-to='{"x":20,"y":10}'><path d="M10 10 H20" stroke="black" stroke-width=".35" fill="none"/></g></g>`;
  expect(
    attachmentAudit(await openSheet(page, svg(body)), source).findings[0]?.kind,
  ).toBe("attachment-owner-unresolved");
});

it("loop label plates and text never enter the electrical route population", async () => {
  const body = `<g data-loop-conductor="w"><path d="M10 20 H20 V23 H30" stroke="black" stroke-width=".32" fill="none"/><rect x="11" y="15" width="8" height="4" fill="white" stroke="black" stroke-width=".1"/><text x="12" y="18" font-size="2.5">W1</text></g>`;
  expect(
    loopRouteFindings(await openSheet(page, svg(body)), {
      wires: [{ uid: "w" }],
    }),
  ).toEqual([]);
});
