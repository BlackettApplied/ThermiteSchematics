import { nativeContactRole } from "./contact-role-oracle.mjs";
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function isRoleReferenceCaption(
  ir,
  row,
  text,
  functionCaption,
  terminalSet,
) {
  let uid, keys;
  try {
    [uid, keys] = JSON.parse(row);
  } catch {
    return false;
  }
  if (!Array.isArray(keys) || !keys.length) return false;
  const fs = keys.map((key) =>
    ir.functions.find(
      (f) => f.id.deviceUid === uid && f.id.functionKey === key,
    ),
  );
  if (fs.some((f) => !f)) return false;
  let protection = false;
  const patterns = fs.map((f) => {
    const role = nativeContactRole(ir, f).role;
    const prefix = {
      breaker: "Breaker pole",
      overload: "Overload element",
      fuse: "Fuse element",
    }[role];
    if (!prefix) return escape(functionCaption(f));
    protection = true;
    return (
      prefix + " " + escape(terminalSet(f.terminals.map((t) => t.terminalKey)))
    );
  });
  return (
    protection &&
    new RegExp("^" + patterns.join(", ") + "$").test(
      text.replace(/\s+/g, " ").trim(),
    )
  );
}
