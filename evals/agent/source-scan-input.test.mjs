import { expect, it } from "vitest";
import { score } from "./score-log.mjs";
const url =
  "https://github.com/BlackettApplied/ThermiteSchematics/blob/dev/packages/compiler/src/index.ts";
const metric = (command) =>
  score({
    engineRoots: ["/engine"],
    transcript: [
      {
        type: "item.completed",
        item: { id: "write", type: "command_execution", command, exit_code: 0 },
      },
    ],
  });
it("writing source/issue links into quoted Markdown is not a source read", () => {
  const command = `/bin/zsh -lc "cat > friction.md <<'EOF'\n# Findings\nSee ${url}\nhttps://github.com/BlackettApplied/ThermiteSchematics/issues/365\nEOF"`;
  expect(metric(command).sourceReads).toBe(0);
  expect(metric(command).issueLookups).toHaveLength(0);
});
it("preserves real reads around reports and executable/unquoted here-docs", () => {
  for (const command of [
    `cat > friction.md <<'EOF'\n${url}\nEOF\ncat /engine/source.ts`,
    `curl '${url}'\ncat > friction.md <<'EOF'\n# Findings\nEOF`,
    `python3 - <<'PY'\nfetch('${url}')\nPY`,
    `cat > helper.sh <<'EOF'\ncurl '${url}'\nEOF\nbash helper.sh`,
    `cat > friction.md <<'EOF'\ncurl '${url}'\nEOF\nbash friction.md`,
    `cat > friction.md <<EOF\n$(cat /engine/source.ts)\nEOF`,
  ])
    expect(metric(command).sourceReads, command).toBe(1);
});

it("keeps a local Python heredoc after an authored report as other", () => {
  expect(
    metric(
      `cat > friction.md <<'EOF'\nnotes\nEOF\npython3 - <<'PY'\nprint('write matrix')\nPY`,
    ).sourceReads,
  ).toBe(0);
});

it("recognizes a completed Markdown append and the Codex wrapper's spliced delimiter", () => {
  const script = `cp work/issue-draft.md issue-draft.md\ncat >> issue-draft.md <<'EOF'\ncurl ${url}\nEOF\ncat > friction.md <<'EOF'\ncurl ${url}\nEOF\npython3 - <<'PY'\nprint('local output')\nPY\ngit status --short`;
  const wrap = (body) =>
    "/bin/zsh -lc '" + body.replaceAll("'", "'\"'\"'") + "'";
  expect(metric(wrap(script)).sourceReads).toBe(0);
  for (const tail of [
    `curl ${url}`,
    "bash issue-draft.md",
    "sh < friction.md",
    "chmod +x friction.md\n./friction.md",
  ]) {
    expect(metric(wrap(script + "\n" + tail)).sourceReads, tail).toBe(1);
  }
});

it.each([
  "bash -x notes.md",
  "sh -eu notes.md",
  "env bash notes.md",
  "cat notes.md | sh",
  "perl notes.md",
  "cp notes.md run.sh && sh run.sh",
  "xargs -a notes.md -I{} sh -c {}",
])(
  "keeps sourced Markdown in either wrapper or a later command: %s",
  (tail) => {
    const script = `cat > notes.md <<'EOF'\ncurl -s ${url}\nEOF`;
    const quote = (body) =>
      "/bin/zsh -lc '" + body.replaceAll("'", "'\"'\"'") + "'";
    expect(metric(quote(script + "\n" + tail)).sourceReads).toBe(1);
    expect(
      metric('/bin/zsh -lc "' + script + "\n" + tail + '"').sourceReads,
    ).toBe(1);
    const shell = (id, command) => ({
      type: "item.completed",
      item: {
        id,
        type: "command_execution",
        command,
        exit_code: 0,
      },
    });
    expect(
      score({ transcript: [shell("write", quote(script)), shell("run", tail)] })
        .sourceReads,
    ).toBe(1);
    expect(
      score({
        transcript: [
          shell("write", quote(script)),
          shell("read", "cat notes.md"),
        ],
      }).sourceReads,
    ).toBe(0);
  },
);

const report = `cat > report.md <<'EOF'\ncurl -s ${url}\nEOF`;
const transports = {
  Claude: (command) => ({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: command, name: "Bash", input: { command } },
      ],
    },
  }),
  "Codex single-quoted wrapper": (command) =>
    codex("/bin/zsh -lc '" + command.replaceAll("'", "'\"'\"'") + "'"),
  "Codex double-quoted wrapper": (command) =>
    codex('/bin/zsh -lc "' + command.replaceAll('"', '\\"') + '"'),
};
function codex(command) {
  return {
    type: "item.completed",
    item: { id: command, type: "command_execution", command, exit_code: 0 },
  };
}
function scoreReportCases(label, transport, tails, expected) {
  it.each(tails)(label + " %s", (tail) => {
    expect(
      score({ transcript: [transport(report + "\n" + tail)] }).sourceReads,
    ).toBe(expected);
    expect(
      score({ transcript: [transport(report), transport(tail)] }).sourceReads,
    ).toBe(expected);
  });
}

for (const [label, transport] of Object.entries(transports)) {
  scoreReportCases(
    label + " keeps reports inert for",
    transport,
    [
      "cp report.md drawings/",
      "mv report.md drawings/",
      "cp report.md drawings/friction.md && cat drawings/friction.md",
      "sed -n 1,5p report.md",
      "sed -n -e '1,5p' report.md",
      "sed -n 'w backup.md' report.md",
      "cat report.md | grep compile | wc -l",
      "cat report.md > duplicate.md",
      "head report.md; tail report.md; less report.md; wc -l report.md; grep title report.md",
      "git add report.md",
      "git diff --stat -- report.md",
      "git commit -m 'Draft report' -- report.md",
      "git show HEAD:report.md",
      "bash -c 'cat report.md'",
      "chmod +x report.md",
    ],
    0,
  );
  scoreReportCases(
    label + " keeps the body in scope for",
    transport,
    [
      "bash -x report.md",
      "sh -eu report.md",
      "env bash report.md",
      "env -i python3 -u report.md",
      "env -u PYTHONPATH python3 -u report.md",
      "zsh report.md",
      "node --trace-warnings report.md",
      "perl report.md",
      "ruby report.md",
      "source report.md",
      ". report.md",
      "sh -c 'source report.md'",
      "bash -c '$(cat report.md)'",
      'sh -c "$(cat report.md)"',
      "xargs -a report.md -I{} sh -c {}",
      "cat report.md | grep curl | sh",
      "cat report.md | python3",
      "git show HEAD:report.md | sh",
      "git -C . show :report.md | sh",
      "cp report.md run.sh && sh run.sh",
      "mv report.md drafts/ && env bash drafts/report.md",
      "cp report.md run.sh && chmod +x run.sh && ./run.sh",
      "chmod +x report.md && ./report.md",
      "cat report.md > copy && sh copy",
      "sed 'e' report.md",
      "sed 's/^curl/curl/e' report.md",
      "sed -n 'w copy' report.md && sh copy",
    ],
    1,
  );
}
