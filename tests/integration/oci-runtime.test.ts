import {describe,expect,it} from "vitest";
import {ociContainerRuntime} from "../../lib/oci-runtime";

describe("real OCI runtime",()=>{ 
  it("runs the complete isolated lifecycle against a Docker daemon",async()=>{
    const health=await ociContainerRuntime.health();
    expect(health.ok,health.detail).toBe(true);
    const id=`OCI-CI-${Date.now()}`;
    const limits={cpuMillicores:500,memoryMb:256,storageMb:128,timeoutMs:60_000,processes:32};
    try{
      const created=await ociContainerRuntime.create({
        id,type:"integration",network:{mode:"DENY",allowlist:[]},limits,risk:"LOW",argv:["sleep","infinity"],image:process.env.BOB_OCI_IMAGE??"alpine:3.20"
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
