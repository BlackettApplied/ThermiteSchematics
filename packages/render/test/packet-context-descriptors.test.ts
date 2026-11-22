import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderDiagnosticContext } from "../src/render-diagnostic-context.js";
import { normalizePaperPage } from "../src/index.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error("Missing native fixture");
  ir = compiled.ir;
});
function pageFailure() {
  const result = normalizePaperPage({ size: "bad" });
  if (result.ok) throw Error("Expected invalid page");
  return result.error;
}
const bill = () => ({
  format: "documentation-view-request/0.1",
  kind: "bom",
  title: "Authored bill",
});
it.each([0, 1, 41])(
  "packet context inspects a proxied views array of length %i without get traps",
  (length) => {
    let gets = 0;
    const views = new Proxy(Array.from({ length }, bill), {
      get(target, key, receiver) {
        gets++;
        return Reflect.get(target, key, receiver);
      },
    });
    const error = renderDiagnosticContext(
      ir,
      { format: "schematic-packet-request/0.1", views },
      pageFailure(),
    );
    expect(gets).toBe(0);
    expect(error.details).toMatchObject({
      diagnosticContext: {
        views: length
          ? [{ viewIndex: length > 40 ? 40 : 0, title: "Authored bill" }]
          : [],
      },
    });
  },
);
it("packet context never invokes request, element or nested view accessors", () => {
  let calls = 0;
  const view = Object.defineProperty(bill(), "title", {
    get() {
      calls++;
      throw Error("title getter");
    },
  });
  const views = [view];
  const original = pageFailure();
  const result = renderDiagnosticContext(
    ir,
    { format: "schematic-packet-request/0.1", views },
    original,
  );
  expect(result).toMatchObject(original);
  expect(result.details).toMatchObject({
    diagnosticContext: { scopeUnavailable: true, views: [] },
  });
  expect(calls).toBe(0);
});
it("proxy descriptor failure preserves the original diagnostic without a new throw path", () => {
  const original = pageFailure();
  const views = new Proxy([bill()], {
    getOwnPropertyDescriptor() {
      throw Error("descriptor trap");
    },
    get() {
      throw Error("get trap");
    },
  });
  const result = renderDiagnosticContext(
    ir,
    { format: "schematic-packet-request/0.1", views },
    original,
  );
  expect(result).toMatchObject(original);
  expect(result.details).toMatchObject({
    diagnosticContext: { scopeUnavailable: true, views: [] },
  });
});

it("packet request and view snapshots do not use get, prototype or enumeration traps", () => {
  const traps: string[] = [];
  const handler = {
    get() {
      traps.push("get");
      throw Error("ordinary get");
    },
    getPrototypeOf() {
      traps.push("getPrototypeOf");
      throw Error("prototype lookup");
    },
    ownKeys() {
      traps.push("ownKeys");
      throw Error("enumeration");
    },
  };
  const view = new Proxy(bill(), handler);
  const request = new Proxy(
    { format: "schematic-packet-request/0.1", views: [view] },
    handler,
  );
  const result = renderDiagnosticContext(ir, request, pageFailure());
  expect(traps).toEqual([]);
  expect(result.details).toMatchObject({
    diagnosticContext: { views: [{ viewIndex: 0, title: "Authored bill" }] },
  });
});
it("element and request accessors are not invoked during optional packet context", () => {
  let calls = 0;
  const views = [bill()];
  Object.defineProperty(views, "0", {
    get() {
      calls++;
      throw Error("element accessor");
    },
  });
  const result = renderDiagnosticContext(
    ir,
    { format: "schematic-packet-request/0.1", views },
    pageFailure(),
  );
  expect(calls).toBe(0);
  expect(result.details).toMatchObject({
    diagnosticContext: { scopeUnavailable: true },
  });
  const request = Object.defineProperty({}, "views", {
    get() {
      calls++;
      throw Error("views accessor");
    },
  });
  Object.defineProperty(request, "format", {
    value: "schematic-packet-request/0.1",
  });
  expect(
    renderDiagnosticContext(ir, request, pageFailure()).details,
  ).toMatchObject({ diagnosticContext: { scopeUnavailable: true } });
  expect(calls).toBe(0);
});
