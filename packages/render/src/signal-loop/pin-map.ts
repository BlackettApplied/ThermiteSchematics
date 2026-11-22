import type { Conductor } from "../signal-loop.js";

/** A colon keeps signed terminal names distinct from the pin-pair separator. */
export function pinMapPair(member: Pick<Conductor, "ends" | "spare">) {
  const a = member.ends[0].terminalKey,
    b = member.ends[1].terminalKey;
  if (a.includes(":") || b.includes(":"))
    throw new Error(
      `Pin map pair ${JSON.stringify([a, b])}: pin maps cannot show terminal names containing ":"; use an explicit circuit view.`,
    );
  return `${a}:${b}${member.spare ? " spare" : ""}`;
}
