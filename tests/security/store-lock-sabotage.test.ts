import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("Store write-lock security contract", () => {
  it("requires exclusive lock creation and keeps CAS verification inside the lock", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/persistence/store.ts"), "utf8");
    expect(source).toContain('fs.openSync(lock, "wx", 0o600)');
    expect(source).toContain("process.kill(info.pid, 0)");
    expect(source).toContain("stale = !holderAlive && ageMs > LOCK_STALE_MS;");
    const writeStart = source.indexOf("private writeEnvelope(payload: T, expectedRevision: number | null): T {");
    expect(writeStart).toBeGreaterThanOrEqual(0);
    const writeEnd = source.indexOf("
  /**", writeStart + 20);
    const writeBody = source.slice(writeStart, writeEnd === -1 ? source.length : writeEnd);
    expect(writeBody).toContain("return this.withWriteLock(() => {");
    expect(writeBody).toContain("const onDisk = this.currentRevision();");
    expect(writeBody).toContain("fs.renameSync(tmp, this.file);");
  });
});
