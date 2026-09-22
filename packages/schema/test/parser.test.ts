import { describe, expect, it } from "vitest";

import { parseJson } from "../src/parser.js";

describe("the D3 malformed-input parser gate", () => {
  it.each([
    {
      name: "invalid token",
      text: '{"a": @}',
      code: "E002",
      pointer: "",
      line: 1,
      column: 7,
    },
    {
      name: "unexpected EOF",
      text: '{"a": ',
      code: "E002",
      pointer: "",
      line: 1,
      column: 7,
    },
    {
      name: "raw control character in a string",
      text: '{"a": "x\u0001y"}',
      code: "E002",
      pointer: "",
      line: 1,
      column: 9,
    },
    {
      name: "duplicate keys",
      text: '{"a": 1, "a": 2}',
      code: "E003",
      pointer: "/a",
      line: 1,
      column: 10,
    },
    {
      name: "CRLF",
      text: '{\r\n  "a": @\r\n}',
      code: "E002",
      pointer: "",
      line: 2,
      column: 8,
    },
    {
      name: "tab indentation",
      text: '{\n\t"a": @\n}',
      code: "E002",
      pointer: "",
      line: 2,
      column: 7,
    },
    {
      name: "non-ASCII before the error",
      text: '{"é": 1, "a": @}',
      code: "E002",
      pointer: "",
      line: 1,
      column: 15,
    },
  ])("reports a usable offset for $name", (testCase) => {
    const result = parseJson(testCase.text, "spike\\input.json");

    if (testCase.code === "E002") {
      expect(result.value).toBeUndefined();
    } else {
      expect(result.value).toBeDefined();
    }
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: testCase.code,
      file: "spike/input.json",
      jsonPointer: testCase.pointer,
      line: testCase.line,
      column: testCase.column,
    });
  });
});

describe("JSON Pointer node map", () => {
  it("records separate key and value locations with RFC 6901 escaping", () => {
    const text = [
      "{",
      '  "a/b": {',
      '    "~key": [',
      "      true",
      "    ]",
      "  }",
      "}",
    ].join("\n");
    const result = parseJson(text, "input.json");

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toEqual({ "a/b": { "~key": [true] } });
    expect(result.nodes.get("")?.value).toMatchObject({ line: 1, column: 1 });
    expect(result.nodes.get("/a~1b")).toMatchObject({
      key: { line: 2, column: 3 },
      value: { line: 2, column: 10 },
    });
    expect(result.nodes.get("/a~1b/~0key")).toMatchObject({
      key: { line: 3, column: 5 },
      value: { line: 3, column: 13 },
    });
    expect(result.nodes.get("/a~1b/~0key/0")?.value).toMatchObject({
      line: 4,
      column: 7,
    });
  });

  it("uses the last duplicate member for the pointer map and parsed value", () => {
    const result = parseJson('{"key": 1, "key": 2}', "input.json");

    expect(result.value).toEqual({ key: 2 });
    expect(result.nodes.get("/key")).toMatchObject({
      key: { column: 12 },
      value: { column: 19 },
    });
  });
});
