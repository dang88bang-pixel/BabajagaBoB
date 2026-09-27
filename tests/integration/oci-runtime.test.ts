import {describe,expect,it} from "vitest";
import {ociContainerRuntime} from "../../lib/oci-runtime";

/**
 * Echter OCI-Lifecycle gegen einen echten Docker-Daemon (OCI-001).
 *
 * Zwei Betriebsarten, bewusst getrennt — eine „grüne\" Suite ohne Nachweis wäre
 * hier der eigentliche Fehler:
 *
 *   1. **Mit Daemon** (CI-Job `oci-runtime`, lokal mit Docker): der komplette
 *      Lifecycle läuft wirklich — create/start/execute/snapshot/destroy/
 *      restore/start. `BOB_OCI_REQUIRED=1` macht den Daemon zur Pflicht: fehlt
 *      er, ist das ein echter Fehlschlag und kein Überspringen.
 *   2. **Ohne Daemon** (Standard in dieser Umgebung): behauptet wird nichts.
 *      Belegt wird nur, dass die Runtime **fail closed** bleibt — `health()`
 *      meldet „nicht erreichbar\", `create()` wird abgelehnt und legt **keinen**
 *      Sandbox-Handle an. Der Lifecycle selbst bleibt damit ehrlich
 *      `NOT_VERIFIED` (Matrix OCI-001), statt als Erfolg zu erscheinen.
 */
const REQUIRED = process.env.BOB_OCI_REQUIRED === "1";
const IMAGE = process.env.BOB_OCI_IMAGE ?? "alpine:3.20";

describe("real OCI runtime",()=>{
  it("runs the complete isolated lifecycle against a Docker daemon",async()=>{
    const health=await ociContainerRuntime.health();
    const id=`OCI-CI-${Date.now()}`;
    const limits={cpuMillicores:500,memoryMb:256,storageMb:128,timeoutMs:60_000,processes:32};

    if(!health.ok){
      // Ohne Daemon: nur die Verweigerung ist belegbar — kein Behälter entsteht.
      expect(health.detail).toMatch(/docker unavailable/i);
      await expect(ociContainerRuntime.create({
        id,type:"integration",network:{mode:"DENY",allowlist:[]},limits,risk:"LOW",argv:["sleep","infinity"],image:IMAGE
      })).rejects.toThrow();
      expect(ociContainerRuntime.handle(id)).toBeUndefined();
      if(REQUIRED) expect(health.ok,`Docker-Daemon ist Pflicht (BOB_OCI_REQUIRED=1): ${health.detail}`).toBe(true);
      else process.stdout.write(`  \u001b[33mHINWEIS\u001b[0m OCI-Lifecycle bleibt NOT_VERIFIED — kein Docker-Daemon erreichbar (${health.detail}). Mit Daemon: BOB_OCI_REQUIRED=1 npm run test:oci\n`);
      return;
    }

    expect(health.ok,health.detail).toBe(true);
    try{
      const created=await ociContainerRuntime.create({
        id,type:"integration",network:{mode:"DENY",allowlist:[]},limits,risk:"LOW",argv:["sleep","infinity"],image:IMAGE
      });
      expect(created.mode).toBe("REAL_OCI");
      expect(created.state).toBe("READY");

      const started=await ociContainerRuntime.start(id);
      expect(started.state).toBe("RUNNING");
      expect(started.network.mode).toBe("DENY");
      expect(started.limits.storageMb).toBe(128);

      const execution=await ociContainerRuntime.execute(id,["echo","oci-ok"]);
      expect(execution.accepted).toBe(true);
      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("oci-ok");

      const snapshot=await ociContainerRuntime.snapshot(id);
      expect(snapshot.state).toBe("SNAPSHOTTED");
      expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);

      await ociContainerRuntime.destroy(id);
      expect(ociContainerRuntime.handle(id)).toBeUndefined();

      const restored=await ociContainerRuntime.restore(id,snapshot.id);
      expect(restored.mode).toBe("REAL_OCI");
      expect(restored.state).toBe("RESTORED");
      expect(restored.limits).toEqual(limits);

      const restarted=await ociContainerRuntime.start(id);
      expect(restarted.state).toBe("RUNNING");
      const afterRestore=await ociContainerRuntime.execute(id,["echo","restored"]);
      expect(afterRestore.accepted).toBe(true);
      expect(afterRestore.stdout).toContain("restored");
    } finally {
      await ociContainerRuntime.destroy(id).catch(()=>undefined);
    }
  },120_000);
});
