import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../src/admin/sales";

describe("csv", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Ada")).toBe("Ada");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("blocks formula injection", () => {
    expect(csvCell("=HYPERLINK(\"http://x\",\"y\")")).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell("\r=1")).toBe(`"'\r=1"`);
    expect(csvCell(" =1")).toBe(" =1");
  });
  it("builds rows with CRLF", () => {
    expect(toCsv(["a", "b"], [["=x", 1], ["y,z", null]])).toBe("a,b\r\n'=x,1\r\n\"y,z\",\r\n");
  });
});
