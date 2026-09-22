import type { Diagnostic } from "@thermite/schema";
import { analyzeCompleteness } from "../completeness.js";
import type { ElectricalRule } from "./types.js";

export const connectionReviewRule: ElectricalRule = {
  id: "E205",
  evaluate({ ir }) {
    const errors: Diagnostic[] = [];
    for (const device of ir.devices) {
      const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
      const invalid: string[] = [];
      for (const key of Object.keys(
        device.connectionReview?.terminals ?? {},
      ).sort())
        if (!type.terminals.some((t) => t.key === key))
          invalid.push(`terminal ${JSON.stringify(key)}`);
      for (const key of Object.keys(
        device.connectionReview?.ports ?? {},
      ).sort())
        if (!Object.hasOwn(type.ports ?? {}, key))
          invalid.push(`port ${JSON.stringify(key)}`);
      for (const key of Object.keys(
        device.connectionReview?.connectorPorts ?? {},
      ).sort())
        if (!Object.hasOwn(type.connectorPorts ?? {}, key))
          invalid.push(`connector port ${JSON.stringify(key)}`);
      if (invalid.length)
        errors.push({
          ...device.source,
          uid: device.uid,
          code: "E205",
          severity: "error",
          message: `${device.designation} connectionReview references undeclared ${invalid.join(", ")}.`,
          related: [
            {
              file: type.source.file,
              line: type.source.line,
              column: type.source.column,
              note: `Declared connections for ${type.id}.`,
            },
          ],
        });
    }
    return errors;
  },
};

export function completenessWarningRule(
  code: "W903" | "W904" | "W905",
): ElectricalRule {
  return {
    id: code,
    evaluate({ ir }) {
      const report = analyzeCompleteness(ir);
      // One diagnostic per instance/code: the normalizer deduplicates by source pointer.
      // The detailed inventory retains every terminal finding and its definition source.
      return report.devices.flatMap((device) => {
        const findings = report.findings.filter(
          (f) => f.deviceUid === device.uid && f.code === code,
        );
        if (!findings.length) return [];
        return [
          {
            ...device.source,
            uid: device.uid,
            code,
            severity: "warning" as const,
            message: `${device.designation}: ${findings.map((f) => f.message).join(" ")}`,
            related: findings.map((f) => ({
              file: f.definitionSource.file,
              line: f.definitionSource.line,
              column: f.definitionSource.column,
              note: f.message,
            })),
          },
        ];
      });
    },
  };
}
