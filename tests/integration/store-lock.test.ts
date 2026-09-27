import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("DurableStore write-lock exclusivity", () => {
  it("does not bypass a live lock before the lock holder releases it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-lock-"));
    const lock = path.join(root, ".lock-probe.lock");
    const helper = path.join(root, "helper.mjs");
    const storePath = path.join(process.cwd(), "lib/persistence/store.ts");
    fs.writeFileSync(helper,
      "process.env.BOB_STORAGE_DIR = " + JSON.stringify(root) + ";\n" +
      "const { DurableStore } = await import(" + JSON.stringify(storePath) + ");\n" +
      "const store = new DurableStore(\"lock-probe\", 1, () => ({value: 0}));\n" +
      "process.stdout.write(\"started\\n\");\n" +
      "await new Promise(resolve => setTimeout(resolve, 50));\n" +
      "store.write({value: 1});\n" +
      "process.stdout.write(\"completed\\n\");\n"
    );

    const {spawn} = await import("node:child_process");
    const child = spawn(process.execPath, ["--experimental-strip-types", helper], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {...process.env, BOB_STORAGE_DIR: root}
    });

    let stdout = "";
    let stderr = "";
    if (!child.pid) throw new Error("helper process has no pid");
    fs.writeFileSync(lock, JSON.stringify({pid: child.pid, at: Date.now()}), {mode: 0o600});
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`helper did not start: ${stderr}`)), 3_000);
      child.stdout.on("data", () => {
        if (stdout.includes("started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    await new Promise(resolve => setTimeout(resolve, 300));

    expect(stdout).toContain("started");
    expect(stdout).not.toContain("completed");

    // Deterministische Gegenprobe der Schutzregel: Die Sperre muss exklusiv
    // eröffnet werden. Eine Mutation von `wx` zu `w` darf nicht durch einen
    // günstigen Prozess-Timinglauf unbemerkt bleiben.
    const storeSource = fs.readFileSync(storePath, "utf8");
    const lockOpen = storeSource.match(/fs\.openSync\(lock,\s*"([wx]+)",\s*0o600\)/)?.[1];
    expect(lockOpen).toBe("wx");

    child.kill("SIGTERM");
    await new Promise<void>(resolve => child.once("exit", () => resolve()));
    fs.rmSync(root, {recursive: true, force: true});
  }, 8_000);
});
