// Pure parsing of the generated project guide. Every check in
// project-guide.test.ts takes a GuideModel, so its self-tests can run the same
// checks against deliberately broken copies of the guide.

export interface Fence {
  readonly index: number;
  /** 1-based line of the opening fence. */
  readonly line: number;
  readonly lang: string;
  readonly body: string;
}
/** An inline code span in prose, with whitespace collapsed. */
export interface Span {
  readonly text: string;
  readonly line: number;
  /** Index into `GuideModel.sentences` of the sentence containing it. */
  readonly sentence: number;
}
export interface GuideModel {
  readonly text: string;
  readonly bytes: number;
  readonly fences: readonly Fence[];
  /** Prose with fences removed and whitespace collapsed. */
  readonly prose: string;
  /** The whole guide with whitespace collapsed. */
  readonly flat: string;
  readonly spans: readonly Span[];
  readonly sentences: readonly string[];
  /** Per 1-based line: the heading section and prose paragraph it is in. */
  readonly sectionOf: readonly number[];
  readonly paragraphOf: readonly number[];
}

export const flatten = (text: string) => text.replace(/\s+/g, " ").trim();

export function parseFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  let open: { lang: string; line: number; body: string[] } | undefined;
  markdown.split("\n").forEach((text, index) => {
    if (open === undefined) {
      if (/^(\s+```|\s*~~~|\s*````)/.test(text))
        throw new Error(`Unsupported fence style at line ${index + 1}.`);
      const start = /^```(\S*)(?:[ \t]+[^\n]*)?$/.exec(text);
      if (start) open = { lang: start[1]!, line: index + 1, body: [] };
    } else if (text === "```") {
      fences.push({
        index: fences.length,
        line: open.line,
        lang: open.lang,
        body: open.body.join("\n"),
      });
      open = undefined;
    } else open.body.push(text);
  });
  if (open) throw new Error(`Unclosed fence at line ${open.line}.`);
  return fences;
}

/** The guide with every fenced block's lines blanked, keeping line numbers. */
function maskFences(markdown: string) {
  return markdown.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, (block) =>
    block.replace(/[^\n]/g, ""),
  );
}

/** A prose paragraph or list item and its 1-based first line. */
interface Block {
  readonly text: string;
  readonly line: number;
}
/** Paragraphs and list items outside fences; headings are not prose. */
function proseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: { text: string; line: number } | undefined;
  maskFences(markdown)
    .split("\n")
    .forEach((text, index) => {
      const boundary =
        text.trim() === "" || text.startsWith("#") || text.startsWith("- ");
      if (boundary && current) blocks.push(current);
      if (boundary) current = undefined;
      if (text.trim() === "" || text.startsWith("#")) return;
      if (current) current.text += `\n${text}`;
      else current = { text, line: index + 1 };
    });
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Prose sentences, split after `.`, `!` or `?` but never inside an inline code
 * span, and the spans with the sentence each falls in. A list item's leading
 * `- ` is dropped.
 */
function proseOf(markdown: string) {
  const sentences: string[] = [];
  const spans: Span[] = [];
  for (const block of proseBlocks(markdown)) {
    const lines = [...block.text.matchAll(/`([^`]*)`/g)].map(
      (m) => block.line + block.text.slice(0, m.index).split("\n").length - 1,
    );
    const texts: string[] = [];
    const masked = flatten(block.text)
      .replace(/^- /, "")
      .replace(/`[^`]*`/g, (span) => `\u0000${texts.push(span) - 1}\u0000`);
    for (const piece of masked.split(/(?<=[.!?])\s+/)) {
      for (const m of piece.matchAll(/\u0000(\d+)\u0000/g)) {
        const i = Number(m[1]);
        const text = flatten(texts[i]!.slice(1, -1));
        if (text !== "")
          spans.push({ text, line: lines[i]!, sentence: sentences.length });
      }
      sentences.push(
        piece.replace(/\u0000(\d+)\u0000/g, (_, i) => texts[Number(i)]!),
      );
    }
  }
  return { sentences, spans };
}
export const sentencesOf = (markdown: string) => proseOf(markdown).sentences;

export function guideModel(text: string): GuideModel {
  const masked = maskFences(text);
  const { sentences, spans } = proseOf(text);
  const sectionOf: number[] = [0];
  const paragraphOf: number[] = [0];
  let section = 0,
    paragraph = 0,
    inFence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      paragraph += 1;
    } else if (!inFence && line.startsWith("#")) {
      section += 1;
      paragraph += 1;
    } else if (!inFence && line.trim() === "") paragraph += 1;
    sectionOf.push(section);
    paragraphOf.push(paragraph);
  }
  return {
    text,
    bytes: Buffer.byteLength(text),
    fences: parseFences(text),
    prose: flatten(masked),
    flat: flatten(text),
    spans,
    sentences,
    sectionOf,
    paragraphOf,
  };
}

/** The prose paragraph directly above a fence, whitespace collapsed. */
export function leadIn(model: GuideModel, fence: Fence): string {
  const lines = model.text.split("\n");
  let i = fence.line - 2;
  while (i >= 0 && lines[i]!.trim() === "") i -= 1;
  const above: string[] = [];
  const prose = (line: string) => line.trim() !== "" && !/^(```|#)/.test(line);
  for (; i >= 0 && prose(lines[i]!); i -= 1) above.unshift(lines[i]!);
  return flatten(above.join(" "));
}
