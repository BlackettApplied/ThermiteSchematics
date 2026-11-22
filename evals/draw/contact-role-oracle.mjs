import { finding, painted, groupBy } from "./review-geometry.mjs";
export function nativeContactRole(ir, fn) {
  const d = ir.devices?.find((d) => d.uid === fn.id.deviceUid),
    type = ir.deviceTypes?.find((t) => t.id === d?.typeId);
  if (!type) return { reason: "Native type missing" };
  const mark = type.circuitSymbols?.[fn.id.functionKey];
  if (["breaker", "overload", "fuse"].includes(mark)) return { role: mark };
  if (
    mark &&
    /(?:contact|switch|pushbutton|estop|selector)-(?:no|nc)$/.test(mark)
  )
    return { role: "contact", state: mark.endsWith("-nc") ? "NC" : "NO" };
  const power =
    fn.terminals?.length === 2 &&
    fn.terminals.every((e) =>
      type.terminals?.some(
        (t) =>
          t.key === e.terminalKey &&
          /^power_(input|output)$/.test(t.role ?? ""),
      ),
    );
  const protection = {
    "iec:circuit-breaker": "breaker",
    "thermite:breaker": "breaker",
    "iec:overload-relay": "overload",
    "thermite:overload": "overload",
    "iec:fuse": "fuse",
    "thermite:fuse": "fuse",
  }[type.symbol];
  if (power && protection) return { role: protection };
  if (
    protection &&
    !power &&
    !(fn.terminals ?? []).every((e) =>
      type.terminals?.some((t) => t.key === e.terminalKey && t.role),
    )
  )
    return { reason: "Protection function role is unspecified" };
  return fn.kind === "contact"
    ? {
        role: "contact",
        state:
          fn.normal_state === "closed"
            ? "NC"
            : fn.normal_state === "open"
              ? "NO"
              : undefined,
      }
    : { role: fn.kind };
}
function owners(t, ir) {
  let ids = [];
  if (t.row != null && t.columnIndex === 1) {
    try {
      const [uid, keys] = JSON.parse(t.row);
      if (Array.isArray(keys))
        ids = keys.map((key) => ({ deviceUid: uid, functionKey: key }));
    } catch {}
  } else if (t.functionKey || t.labelOwnerKey?.[0] === "function") {
    ids = [
      t.labelOwnerKey?.[0] === "function"
        ? { deviceUid: t.labelOwnerKey[1], functionKey: t.labelOwnerKey[2] }
        : { deviceUid: t.deviceUid, functionKey: t.functionKey },
    ];
  }
  return ids.map((id) =>
    ir.functions?.find(
      (f) =>
        f.id.deviceUid === id.deviceUid && f.id.functionKey === id.functionKey,
    ),
  );
}
export function isContactCaptionField(t, ir) {
  const scope =
    (t.columnIndex === 1 && t.reportRowScope) ||
    t.functionKey ||
    t.labelOwnerKey?.[0] === "function" ||
    t.labelRole === "function";
  return (
    painted(t) &&
    scope &&
    !t.terminal &&
    (owners(t, ir).some((f) => f && f.kind === "contact") ||
      /\b(?:NC|NO)\b/.test(t.text))
  );
}
function claimRoles(text, match, fs, ir) {
  if (fs.length === 1) return fs.map((f) => nativeContactRole(ir, f));
  const clause = text
    .slice(match.index + match[0].length)
    .split(/,\s+(?=[A-Za-z])/)[0];
  const matches = fs.filter(
    (f) =>
      f.terminals.length &&
      f.terminals.every((t) => {
        const at = clause.indexOf(t.terminalKey),
          before = clause[at - 1],
          after = clause[at + t.terminalKey.length];
        return (
          at >= 0 &&
          (!before || !/[\p{L}\p{N}]/u.test(before)) &&
          (!after || !/[\p{L}\p{N}]/u.test(after))
        );
      }),
  );
  return (matches.length ? matches : fs).map((f) => nativeContactRole(ir, f));
}
export function contactCaptionAudit(g, ir) {
  const out = [];
  let eligible = 0;
  const candidates = g.texts.filter((t) => isContactCaptionField(t, ir));
  for (const ts of groupBy(candidates, (t) =>
    JSON.stringify([
      t.documentId,
      t.row,
      t.columnIndex,
      t.functionScope,
      t.labelOwnerKey,
      t.deviceUid,
      t.functionKey,
    ]),
  ).values()) {
    const text = ts.map((t) => t.text).join(" "),
      states = [...text.matchAll(/\b(NC|NO)\b/g)];
    eligible++;
    if (!states.length) continue;
    const fs = owners(ts[0], ir);
    if (!fs.length || fs.some((f) => !f)) {
      out.push(finding("contact-caption-owner-unavailable", ts[0], { text }));
      continue;
    }
    const roles = states.map((m) => claimRoles(text, m, fs, ir));
    if (
      roles.some((list) =>
        list.some((r) => r.role !== "contact" || !r.state),
      ) ||
      states.some((m, i) => !roles[i].every((r) => r.state === (m[1] ?? m[2])))
    )
      out.push(
        finding("contact-caption-contradicts-native-role", ts[0], {
          text,
          functions: fs.map((f) => f.id),
          nativeRoles: roles,
        }),
      );
  }
  return { findings: out, eligible };
}
