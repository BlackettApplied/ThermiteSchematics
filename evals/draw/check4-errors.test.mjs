import { expect, it } from "vitest";
import {
  IdentifierMeasurementError,
  isIdentifierError,
  identifierContext,
} from "./identifier-errors.mjs";
import { identifierFindings } from "./identifier-checks.mjs";
import { mediaIdentifiers } from "./identifier-observations.mjs";
import { observation } from "./evaluate.mjs";
import { missingMarkerRow } from "./marker-missing.mjs";
import { c, documents } from "./check4-fixture.mjs";
it("CHECK4 only the typed measurement error carries identifier context", () => {
  const typed = new IdentifierMeasurementError("missing cells");
  expect(identifierContext(typed, 3, "svg")).toMatchObject({
    sheet: 3,
    medium: "svg",
    instrumentation: "identifier",
  });
  const bug = new TypeError(
    "Identifier measurement: same-looking programming error",
  );
  expect(isIdentifierError(bug)).toBe(false);
  expect(identifierContext(bug, 3, "svg")).toBe(bug);
  expect(bug.sheet).toBeUndefined();
});
it("CHECK4 missing measured cells fail with the explicit type", () => {
  const x = documents();
  delete x.g.reportCells;
  expect(() => identifierFindings(x.g, x.tables[0], x.ir)).toThrow(
    IdentifierMeasurementError,
  );
});
it.each(["wire-locator-missing", "text-outside-cell"])(
  "CHECK4 identifier infrastructure never masks an absent %s pin",
  (kind) => {
    const marker = { id: "pin", dq: "DQ-19", check: "sheet", kind };
    const unit = { case: "fixture", sheet: "sheet:1", medium: "svg" };
    const rows = [
      { status: "infrastructure-error", instrumentation: "identifier" },
    ];
    expect(missingMarkerRow(marker, "key", unit, false, rows).status).toBe(
      "xpass",
    );
    expect(
      missingMarkerRow(
        { ...marker, kind: "identifier-line-break" },
        "key",
        unit,
        false,
        rows,
      ).status,
    ).toBe("infrastructure-error");
  },
);
it("CHECK4 a PDF programming error is not mistaken for a PDF data failure", async () => {
  const x = documents();
  const error = new TypeError("PDF programming sentinel");
  await expect(
    mediaIdentifiers(
      c,
      x.s,
      x.packet,
      x.g,
      x.g,
      x.ir,
      x.tables,
      {
        getTextContent: async () => {
          throw error;
        },
      },
      {},
      observation,
    ),
  ).rejects.toThrow(error);
});
