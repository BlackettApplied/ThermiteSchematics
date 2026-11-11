import { beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { prepareCommunicationPages } from "../src/communication.js";
import { prepareConnectorAssemblyPages } from "../src/connector-assembly.js";
import { topologyDrafts } from "../src/packet/topology.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { deviceTagFitDetails } from "../src/packet/device-tag-fit.js";
import { drawingDeviceTag } from "../src/device-tag-svg.js";

vi.mock("../src/communication.js", async (original) => ({
  ...(await original<typeof import("../src/communication.js")>()),
  prepareCommunicationPages: vi.fn(),
}));
vi.mock("../src/connector-assembly.js", async (original) => ({
  ...(await original<typeof import("../src/connector-assembly.js")>()),
  prepareConnectorAssemblyPages: vi.fn(),
}));

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
const tag = (designation: string, description = "Short description") => {
  const base = ir.devices[0]!;
  return drawingDeviceTag(
    { ...base, uid: designation, designation, description },
    ir.deviceTypes.find((t) => t.id === base.typeId)!,
    48,
  );
};

it("names only the limiting tag and field, retaining the full inventory in details", () => {
  const normal = Array.from({ length: 30 }, (_, i) => tag(`OTHER${i}`));
  const offender = tag("LIMIT", "Long qualification ".repeat(60));
  const fit = deviceTagFitDetails(
    { width: 120, height: 500, deviceTags: [...normal, offender] },
    160,
    180,
  );
  expect(fit.message).toContain("Device LIMIT description");
  expect(fit.message).not.toContain("OTHER");
  expect(fit.message).toContain("120.00 × 500.00 mm");
  expect(fit.message).toContain("160.00 × 180.00 mm available");
  expect(fit.message.length).toBeLessThan(450);
  expect(fit.deviceTag).toMatchObject({
    designation: "LIMIT",
    field: "description",
  });
  expect(fit.deviceTags).toHaveLength(31);
});

it.each(["communication", "connector-assembly"] as const)(
  "does not attach a prior %s fit refusal to an unrelated later error",
  async (kind) => {
    const selected = ir.devices.find((d) => d.designation === "HMI1")!;
    const previous = ir.devices.find((d) => d.designation === "KP8")!;
    const plan = drawingDeviceTag(
      previous,
      ir.deviceTypes.find((t) => t.id === previous.typeId)!,
      48,
    );
    const drawing = {
      title: "Trial",
      content: "",
      width: 10000,
      height: 10000,
      note: "",
      references: [
        {
          deviceUid: previous.uid,
          designation: previous.designation,
          x: 0,
          y: 0,
        },
      ],
      deviceTags: [plan],
    };
    const prepare =
      kind === "communication"
        ? vi.mocked(prepareCommunicationPages)
        : vi.mocked(prepareConnectorAssemblyPages);
    const paper = normalizePaperPage();
    if (!paper.ok) throw Error(paper.error.message);
    for (const succeeds of [false, true]) {
      prepare.mockImplementationOnce(async (_ir, _request, fits) => {
        expect(fits(drawing)).toBe(false);
        if (succeeds)
          expect(fits({ ...drawing, width: 30, height: 30 })).toBe(true);
        throw Error("Unrelated route validation failure");
      });
      const result = await topologyDrafts(
        ir,
        kind === "communication"
          ? {
              format: "communication-view-request/0.1",
              medium: "ethernet",
              devices: ["HMI1"],
            }
          : {
              format: "connector-assembly-view-request/0.1",
              devices: ["HMI1"],
            },
        undefined,
        paper.value,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Unrelated route validation failure");
        expect(result.error.details).not.toHaveProperty("deviceTags");
        expect(result.error.details?.devices).toEqual([
          expect.objectContaining({ deviceUid: selected.uid }),
        ]);
      }
    }
  },
);
