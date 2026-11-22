import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  createSchematicRenderer,
  renderSchematic,
  renderSchematicSheets,
  renderSchematicPacket,
  type RenderOutcome,
} from "../src/index.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";
import * as diagnosticContext from "../src/render-diagnostic-context.js";
import * as packetErrors from "../src/packet/errors.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error("Missing compiled audit fixture");
  ir = compiled.ir;
});
afterEach(() => vi.restoreAllMocks());
const valid = () =>
  JSON.parse(
    '{"format":"schematic-view-request/0.1","root":{"by":"uid","value":"missing"},"family":"control"}',
  );
function rejected<T>(outcome: RenderOutcome<T>) {
  if (outcome.ok) throw Error("Expected rejected request");
  return outcome.error;
}
const entryPoints = [
  { name: "renderSchematic", run: renderSchematic },
  { name: "factory.render", run: createSchematicRenderer().render },
];
it.each(entryPoints)(
  "$name preserves R001 for a revoked Proxy",
  async ({ run }) => {
    const proxy = Proxy.revocable(valid(), {});
    proxy.revoke();
    const original = rejected(
      await createSchematicRendererWithDependencies().render(ir, proxy.proxy),
    );
    const actual = rejected(await run(ir, proxy.proxy));
    expect(actual).toMatchObject(original);
    expect(actual.code).toBe("R001");
  },
);
it.each(entryPoints)(
  "$name never invokes a throwing format accessor",
  async ({ run }) => {
    const request = Object.defineProperty(valid(), "format", {
      get() {
        throw Error("late trap");
      },
    });
    const original = rejected(
      await createSchematicRendererWithDependencies().render(ir, request),
    );
    expect(rejected(await run(ir, request))).toMatchObject(original);
  },
);
it.each(entryPoints)(
  "$name inspects format/root/family through data descriptors",
  async ({ run }) => {
    for (const key of ["format", "root", "family"] as const) {
      let calls = 0;
      const request = valid(),
        value = request[key];
      Object.defineProperty(request, key, {
        get() {
          calls++;
          return value;
        },
      });
      expect(rejected(await run(ir, request)).code).toBe("R001");
      expect(calls, key).toBe(0);
    }
  },
);
it("implicit sheets do not add accessor reads after an invalid page failure", async () => {
  let calls = 0;
  const request = Object.defineProperty(valid(), "format", {
    get() {
      calls++;
      throw Error("late trap");
    },
  });
  const error = rejected(
    await renderSchematicSheets(
      ir,
      request,
      undefined,
      JSON.parse('{"size":"bad"}'),
    ),
  );
  expect(error.code).toBe("R006");
  expect(calls).toBe(0);
});
it("failed context lookup preserves the original diagnostic and marks scopeUnavailable", async () => {
  const request = { ...valid(), format: "bad" };
  const original = rejected(
    await createSchematicRendererWithDependencies().render(
      ir,
      JSON.parse(JSON.stringify(request)),
    ),
  );
  vi.spyOn(packetErrors, "packetViewContext").mockImplementation(() => {
    throw Error("context lookup failed");
  });
  const actual = rejected(
    await renderSchematic(ir, JSON.parse(JSON.stringify(request))),
  );
  expect(actual).toMatchObject(original);
  expect(actual).toMatchObject({
    details: {
      diagnosticContext: {
        requestField: "/",
        views: [],
        scopeUnavailable: true,
      },
    },
  });
});
it.each([null, 42, "x", {}, []])(
  "omits invented view titles for %j",
  async (request) => {
    const error = rejected(
      await renderSchematic(ir, JSON.parse(JSON.stringify(request))),
    );
    expect(error).toMatchObject({
      details: { diagnosticContext: { views: [] } },
    });
    expect(JSON.stringify(error)).not.toContain("Untitled view");
  },
);
it.each(["", "bad\u0001name"])(
  "does not echo invalid project name %j",
  async (name) => {
    const native = structuredClone(ir);
    native.project.name = name;
    const error = rejected(
      await renderSchematic(
        native,
        JSON.parse(
          '{"format":"schematic-view-request/0.1","root":{"by":"designation","value":"K1"},"family":"control"}',
        ),
      ),
    );
    expect(error.code).toBe("R005");
    expect(error).toHaveProperty("details.diagnosticContext");
    const details = JSON.parse(JSON.stringify(error));
    expect(details.details.diagnosticContext).not.toHaveProperty("projectName");
  },
);
it("packet context lookup failures preserve the page diagnostic", async () => {
  const request = {
    format: "schematic-packet-request/0.1" as const,
    page: JSON.parse('{"size":"bad"}'),
    views: [
      Object.defineProperty({}, "title", {
        get() {
          throw Error("title trap");
        },
      }),
    ],
  };
  const error = rejected(
    await renderSchematicPacket(
      ir,
      JSON.parse(JSON.stringify(null)) ?? request,
    ),
  );
  expect(error).toMatchObject({
    code: "R006",
    message:
      "Use letter, tabloid, a4 or a3; landscape or portrait; and a margin from 5 to 25 mm.",
    details: { diagnosticContext: { views: [], scopeUnavailable: true } },
  });
});

it.each(entryPoints)(
  "$name never invokes nested selector and intent accessors",
  async ({ run }) => {
    for (const key of ["by", "value"]) {
      let calls = 0;
      const request = valid();
      Object.defineProperty(request.root, key, {
        get() {
          calls++;
          throw Error("nested trap");
        },
      });
      expect(rejected(await run(ir, request)).code).toBe("R001");
      expect(calls).toBe(0);
    }
    let calls = 0;
    const request = {
      ...valid(),
      format: "schematic-view-request/0.2",
      intent: {},
    };
    Object.defineProperty(request.intent, "kind", {
      get() {
        calls++;
        throw Error("intent trap");
      },
    });
    expect(rejected(await run(ir, request)).code).toBe("R001");
    expect(calls).toBe(0);
  },
);
it("implicit sheets preserve the selected page failure for a revoked view", async () => {
  const view = Proxy.revocable(valid(), {});
  view.revoke();
  const error = rejected(
    await renderSchematicSheets(
      ir,
      view.proxy,
      undefined,
      JSON.parse('{"size":"bad"}'),
    ),
  );
  expect(error).toMatchObject({
    code: "R006",
    details: {
      diagnosticContext: {
        requestField: "/page",
        views: [],
        scopeUnavailable: true,
      },
    },
  });
});

it("packet context adds no ordinary reads to the pre-existing views getter path", async () => {
  let calls = 0;
  const request = {
    format: "schematic-packet-request/0.1" as const,
    page: JSON.parse('{"size":"bad"}'),
    get views() {
      calls++;
      return [];
    },
  };
  const passthrough = vi
    .spyOn(diagnosticContext, "contextualRenderOutcome")
    .mockImplementation((_ir, _request, result) => result);
  const original = rejected(await renderSchematicPacket(ir, request));
  const baselineReads = calls;
  passthrough.mockRestore();
  calls = 0;
  const error = rejected(await renderSchematicPacket(ir, request));
  expect(error).toMatchObject(original);
  expect(baselineReads).toBe(4);
  expect(calls).toBe(baselineReads);
  expect(error).toMatchObject({
    details: { diagnosticContext: { scopeUnavailable: true } },
  });
});
