// Structural compact presentation model shared with canonical validation.
export interface PageSettings {
  readonly size?: "letter" | "tabloid" | "a4" | "a3";
  readonly orientation?: "landscape" | "portrait";
  readonly marginMm?: number;
}
export const slots = [
  "project",
  "sheetTitle",
  "drawingNumber",
  "customer",
  "drawnBy",
  "date",
  "checkedBy",
  "approvedBy",
  "revision",
  "sheetNumber",
] as const;
export type Slot = (typeof slots)[number];
export const bindings = {
  project: "project.name",
  sheetTitle: "sheet.title",
  revision: "sheet.revision",
  sheetNumber: "sheet.numberOfTotal",
} as const;
export type Binding = (typeof bindings)[keyof typeof bindings];
export interface Field {
  readonly slot: Slot;
  readonly label: string;
  readonly value?: string | null;
  readonly bind?: Binding;
  readonly pattern?: string;
}
export interface Grid {
  readonly columns: 6;
  readonly rows: 4;
}
export interface Presentation {
  readonly format: "project-presentation/0.3";
  readonly $schema?: string;
  readonly revision?: string;
  readonly backgroundColor?: string;
  readonly page?: PageSettings;
  readonly frame?: {
    readonly zones?: {
      readonly default?: Grid;
      readonly byPaper?: Partial<
        Record<
          NonNullable<PageSettings["size"]>,
          Partial<Record<NonNullable<PageSettings["orientation"]>, Grid>>
        >
      >;
    };
    readonly header?: { readonly text: string };
    readonly generatorStamp?: "title" | "border" | "metadata";
  };
  readonly titleBlock?: {
    readonly profile?: "compact";
    readonly lines?: readonly string[];
    readonly fields?: Readonly<Partial<Record<Slot, Field>>>;
  };
}
