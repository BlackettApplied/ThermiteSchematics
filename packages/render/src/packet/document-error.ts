import type { DocumentDependency } from "./document-types.js";
export class DocumentDependencyError extends Error {
  readonly details: Readonly<Record<string, unknown>>;
  constructor(
    message: string,
    needs: readonly DocumentDependency[],
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.details = {
      documentInvariant: true,
      documentDependencies: needs.map((n) => n.id),
      subjects: needs.map((n) => n.subject),
      sourceNotes: needs.map((n) => n.owner),
      requiredFacts: needs.map((n) => n.requiredFacts),
      ...details,
    };
  }
}
