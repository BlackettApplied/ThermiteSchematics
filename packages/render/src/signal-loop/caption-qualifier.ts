import { measureText, wrapText } from "../text-metrics.js";

/** A slash qualifier may stay with its preceding word at unchanged row count.
 * If the grouped atoms cannot fit, retain the native caption and geometry. */
export function wrapCaptionQualifier(value: string, width: number) {
  const original = wrapText(value, width, 2.7);
  if (!/\S+\s+\/\s+\S+/u.test(value)) return original;
  const normalized = value.normalize("NFC");
  const lines: string[] = [];
  let line = "",
    cursor = 0;
  for (const atom of qualifierAtoms(normalized)) {
    const text = normalized.slice(atom.start, atom.end);
    if (measureText(text, 2.7).width > width) return original;
    const gap = normalized.slice(cursor, atom.start);
    const next = line + gap + text;
    if (measureText(next, 2.7).width > width) {
      lines.push(line + gap);
      line = text;
    } else line = next;
    cursor = atom.end;
  }
  lines.push(line + normalized.slice(cursor));
  return lines.length <= original.length ? lines : original;
}

interface CaptionAtom {
  start: number;
  end: number;
}

function signedAtoms(value: string): CaptionAtom[] {
  const words = [...value.matchAll(/\S+/gu)],
    atoms: CaptionAtom[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const prior = atoms.at(-1),
      next = words[i + 1];
    if (prior && word[0] !== "/" && /^[^\p{L}\p{N}]+$/u.test(word[0]))
      prior.end = word.index + word[0].length;
    else {
      const atom = { start: word.index, end: word.index + word[0].length };
      if (
        /^[+−±-](?:\/-)?\d/u.test(word[0]) &&
        next &&
        /^\p{L}+$/u.test(next[0])
      ) {
        atom.end = next.index + next[0].length;
        i++;
      }
      atoms.push(atom);
    }
  }
  return atoms;
}

function qualifierAtoms(value: string): CaptionAtom[] {
  const words = signedAtoms(value),
    atoms: CaptionAtom[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const prior = atoms.at(-1),
      next = words[i + 1];
    if (prior && value.slice(word.start, word.end) === "/") {
      const polarity = /[+−±-]$/u.test(value.slice(prior.start, prior.end));
      prior.end = next && !polarity ? next.end : word.end;
      if (next && !polarity) i++;
    } else atoms.push({ ...word });
  }
  return atoms;
}
