import { isIdentifierError } from "./identifier-errors.mjs";
export function caseInfrastructure(error, c, local, root, engine) {
  const identifier = isIdentifierError(error);
  return {
    case: c.id,
    spec: c,
    ok: false,
    ...(identifier ? { instrumentation: "identifier" } : {}),
    sheets: [],
    rows: [
      ...local,
      {
        id: `${c.id}/infrastructure`,
        case: c.id,
        status: "infrastructure-error",
        ...(identifier
          ? {
              instrumentation: "identifier",
              sheet: error.sheet,
              medium: error.medium,
            }
          : {}),
        reason: error.message
          .replaceAll(root, "<evals>")
          .replaceAll(engine, "<engine>"),
      },
    ],
  };
}
