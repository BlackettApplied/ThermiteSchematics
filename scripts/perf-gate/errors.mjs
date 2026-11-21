export class PerfFailure extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}
export function correctnessFailure(side, message) {
  return new PerfFailure(`${side}: ${message}`, side === "head" ? 3 : 2);
}
