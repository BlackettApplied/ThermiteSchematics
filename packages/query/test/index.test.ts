import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as query from "../src/index.js";

describe("query public API", () => {
  it("exports the query, documentation and review APIs without private path helpers", () => {
    expect(Object.keys(query).sort()).toEqual([
      "InvalidElectricalIrError",
      "REPORT_KINDS",
      "auditContinuity",
      "buildCableSchedule",
      "buildCommunicationInventory",
      "buildConnectorAssemblyInventory",
      "buildDocumentation",
      "createProjectSnapshot",
      "createQueryEngine",
      "documentationCsv",
      "formatTerminalSet",
      "parseProjectSnapshot",
      "printedPort",
      "printedPortEndpoint",
      "relationPrintIdentity",
      "resolveDeviceFilter",
      "reviewProject",
      "serializeQueryResult",
    ]);
    expect(query).not.toHaveProperty("shortestConductivePath");
  });

  it("publishes a single device filter resolver signature that requires an IR", () => {
    const declarations = readFileSync(
      new URL("../dist/device-filter.d.ts", import.meta.url),
      "utf8",
    );
    expect(
      declarations.match(
        /export declare function resolveDeviceFilter\([^;]+;/gu,
      ),
    ).toEqual([
      "export declare function resolveDeviceFilter(ir: Readonly<ElectricalIr>, value: DeviceFilter): DeviceFilterSelection;",
    ]);
  });
});
