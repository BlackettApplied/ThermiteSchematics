import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";

export async function consoleWiringFixture() {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  return {
    ir: c.ir,
    request: JSON.parse(
      await readFile("examples/operator-console/packet.request.json", "utf8"),
    ),
  };
}
