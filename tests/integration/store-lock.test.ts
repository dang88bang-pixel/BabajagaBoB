import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

describe("DurableStore write-lock exclusivity", () => {
  it("does not bypass a live lock before the lock holder releases it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-lock-"));
    const lock = path.join(root, ".lock-probe.lock");
    fs.writeFileSync(lock, JSON.stringify({pid: process.pid, at: Date.now()}), {mode: 0o600});

    const helper = path.join(root, "helper.mjs");
    const storePath = path.join(process.cwd(), "lib/persistence/store.ts");
    fs.writeFileSync(helper,
      "process.env.BOB_STORAGE_DIR = " + JSON.stringify(root) + ";\n" +
      "const { DurableStore } = await import(" + JSON.stringify(storePath) + ");\n" +
      "const store = new DurableStore(\"lock-probe\", 1, () => ({value: 0}));\n" +
      "store.write({value: 1});\n" +
      "process.stdout.write(\"completed\");\n"
    );

    const {spawn} = await import("node:child_process");
    const child = spawn(process.execPath, ["--experimental-strip-types", helper], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {...process.env, BOB_STORAGE_DIR: root}
    });

    let stdout = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });

    const result = await new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({code: null, signal: "SIGTERM"});
      }, 300);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({code, signal});
      });
    });

    expect(result.signal).toBe("SIGTERM");
    expect(stdout).not.toContain("completed");
    fs.rmSync(root, {recursive: true, force: true});
  }, 5_000);
});
