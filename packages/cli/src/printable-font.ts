import { PrintableFontBudgetError } from "@thermite/render/internal/printable-font";

export {
  embedPrintableFont,
  PrintableFontBudgetError,
  printableFontStyle,
  subsetPrintableFont,
} from "@thermite/render/internal/printable-font";

type FontBudgetFailure = {
  code: "R007";
  message: string;
  details: { bytes: number; maximum: number };
};
export function fontBudgetFailure(
  error: unknown,
  root: string,
): (FontBudgetFailure & { root: string }) | undefined;
export function fontBudgetFailure(
  error: unknown,
): FontBudgetFailure | undefined;
export function fontBudgetFailure(error: unknown, root?: string) {
  if (!(error instanceof PrintableFontBudgetError)) return undefined;
  return {
    code: error.code,
    message: error.message,
    ...(root === undefined ? {} : { root }),
    details: { bytes: error.bytes, maximum: error.maximum },
  };
}
