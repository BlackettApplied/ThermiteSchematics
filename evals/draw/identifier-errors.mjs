// Also serialized into the browser measurement helpers; keep it self-contained.
export class IdentifierMeasurementError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "IdentifierMeasurementError";
    this.code = "THERMITE_IDENTIFIER_MEASUREMENT";
  }
}
export const isIdentifierError = (error) =>
  error instanceof IdentifierMeasurementError;
export function requireReportCells(g) {
  if (g.texts.some((t) => t.row && !t.cell))
    throw new IdentifierMeasurementError(
      "Report text lacks an independently measured cell bbox",
    );
}
export function identifierContext(error, sheet, medium) {
  if (isIdentifierError(error))
    Object.assign(error, { sheet, medium, instrumentation: "identifier" });
  return error;
}
