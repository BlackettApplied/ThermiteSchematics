import { describe, expect, it } from "vitest";

import * as query from "../src/index.js";

describe("query public API", () => {
  it("exports the query, documentation and review APIs without private path helpers", () => {
    expect(Object.keys(query).sort()).toEqual([
      "InvalidElectricalIrError",
      "REPORT_KINDS",
      "buildCableSchedule",
      "buildCommunicationInventory",
      "buildConnectorAssemblyInventory",
      "buildDocumentation",
      "createProjectSnapshot",
      "createQueryEngine",
      "documentationCsv",
      "parseProjectSnapshot",
      "reviewProject",
      "serializeQueryResult",
    ]);
    expect(query).not.toHaveProperty("shortestConductivePath");
  });
});
