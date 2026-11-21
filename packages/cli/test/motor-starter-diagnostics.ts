import { readFileSync } from "node:fs";
import type { Diagnostic } from "@thermite/schema";

// Reviewed CLI reports pin the complete summary, net identities and locations.
function reviewedDiagnostics(path: string): Diagnostic[] {
  return JSON.parse(
    readFileSync(new URL(`./goldens/${path}`, import.meta.url), "utf8"),
  ).diagnostics;
}

export const motorDiagnostics = reviewedDiagnostics(
  "motor-starter/render-k1-control-left-to-right.stderr.json",
);
export const pnpMotorDiagnostics = reviewedDiagnostics(
  "motor-starter-pnp/view-k1-actuation-left-to-right.stderr.json",
);
