import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("Store lock sabotage contract", () => {
  it("requires exclusive lock + CAS/rename inside the lock", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/persistence/store.ts"), "utf8");
    expect(source).toMatch(/fs\.openSync\(lock,\s*"wx",\s*0o600\)/);
    const start = source.indexOf("private writeEnvelope(payload: T, expectedRevision: number | null): T {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n  /**", start + 20);
    const body = source.slice(start, end === -1 ? source.length : end);
    expect(body).toContain("return this.withWriteLock(() => {");
    expect(body).toContain("const onDisk = this.currentRevision();");
    expect(body).toContain("if (onDisk !== expectedRevision)");
    expect(body).toContain("fs.renameSync(tmp, this.file);");
    expect(body).not.toContain('fs.writeFileSync(this.file, JSON.stringify(envelope)');
  });
});
