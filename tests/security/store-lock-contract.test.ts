import fs from "node:fs";
import {describe, expect, it} from "vitest";

describe("DurableStore lock contract", () => {
  it("requires exclusive lock creation", () => {
    const source = fs.readFileSync("lib/persistence/store.ts", "utf8");
    expect(source).toContain('fs.openSync(lock, "wx", 0o600)');
    expect(source).not.toContain('fs.openSync(lock, "w", 0o600)');
  });
});
