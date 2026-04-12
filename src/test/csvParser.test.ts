import { describe, it, expect } from "vitest";
import { parseCSVLine, parseCSVRows, parseCSVHeaders } from "@/lib/csvParser";

describe("parseCSVLine", () => {
  it("splits simple comma-separated values", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas inside", () => {
    expect(parseCSVLine('hello,"world, earth",foo')).toEqual(["hello", "world, earth", "foo"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles single field", () => {
    expect(parseCSVLine("only")).toEqual(["only"]);
  });

  it("handles empty string", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });

  it("strips quotes from quoted fields", () => {
    expect(parseCSVLine('"hello","world"')).toEqual(["hello", "world"]);
  });
});

describe("parseCSVRows", () => {
  it("parses a full CSV into trimmed 2D array", () => {
    const csv = "name, age\n Alice , 30 \n Bob , 25 ";
    const result = parseCSVRows(csv);
    expect(result).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("returns single row for header-only CSV", () => {
    expect(parseCSVRows("a,b,c")).toEqual([["a", "b", "c"]]);
  });
});

describe("parseCSVHeaders", () => {
  it("returns lowercase trimmed headers", () => {
    expect(parseCSVHeaders("  Name , AGE , City ")).toEqual(["name", "age", "city"]);
  });

  it("handles quoted headers", () => {
    expect(parseCSVHeaders('"First Name","Last Name"')).toEqual(["first name", "last name"]);
  });
});
