// Expected bad/missing agent data is a task failure. Only explicit harness
// infrastructure faults retain a workspace for a checker-only retry.
export class CheckerInfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckerInfrastructureError";
  }
}
export async function evaluateChecker(checker, ctx) {
  try {
    return await checker(ctx);
  } catch (error) {
    return {
      pass: false,
      error: {
        kind:
          error?.name === "CheckerInfrastructureError"
            ? "checker-error"
            : "task-failure",
        phase: "checker",
        message: error.message,
      },
    };
  }
}
