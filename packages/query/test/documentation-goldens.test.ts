import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { buildDocumentation, documentationCsv } from "../src/documentation.js";

// Text goldens normalize row endings to LF; the CSV API retains its CRLF contract.
it.each(["report-filtering", "machine-demo"])(
  "preserves the %s BOM CSV",
  async (example) => {
    const compiled = await compileProject(`examples/${example}`);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const table = buildDocumentation(
      compiled.ir,
      {
        format: "documentation-view-request/0.1",
        kind: "bom",
      },
      undefined,
      { output: "csv" },
    );
    await expect(
      documentationCsv(table).replaceAll("\r\n", "\n"),
    ).toMatchFileSnapshot(`./goldens/${example}.bom.csv`);
  },
);
