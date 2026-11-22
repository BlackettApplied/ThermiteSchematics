/** Expected geometric failures may retain the original complete ELK layout. */
export class InlineLabelFitError extends Error {}
export class InlineLabelCollisionError extends Error {}

export function isInlineLabelFailure(error: unknown): boolean {
  return (
    error instanceof InlineLabelFitError ||
    error instanceof InlineLabelCollisionError
  );
}
