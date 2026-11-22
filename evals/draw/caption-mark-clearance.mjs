import { INK_ACCURACY_MM } from "./checks.mjs";
import { reportIssue } from "./report-checks.mjs";

const MINIMUM_MM = 2 * INK_ACCURACY_MM;
const axisGap = (a, b, axis, size) =>
  Math.max(0, a[axis] - b[axis] - b[size], b[axis] - a[axis] - a[size]);

export function terminalLabelFindings(g) {
  return (g.terminalLabelClearances ?? []).map(({ caption, ...measurement }) =>
    reportIssue("terminal-label-body-clearance", caption, {
      ...measurement,
      text: caption.text,
    }),
  );
}

export function captionMarkFindings(g) {
  return (g.cableCaptionMarks ?? []).flatMap(
    ({ caption, marks, cableUid, conductorId, side }) => {
      const gapMm = Math.min(
        ...marks.map(({ bbox }) =>
          Math.hypot(
            axisGap(caption.bbox, bbox, "x", "w"),
            axisGap(caption.bbox, bbox, "y", "h"),
          ),
        ),
      );
      return gapMm < MINIMUM_MM
        ? [
            reportIssue("caption-mark-clearance", caption, {
              cableUid,
              conductorId,
              side,
              text: caption.text,
              marks,
              gapMm,
              minimumMm: MINIMUM_MM,
            }),
          ]
        : [];
    },
  );
}
