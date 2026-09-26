import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

let root="";
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-runtime-registry-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
afterEach(()=>{delete process.env.BOB_STORAGE_DIR;fs.rmSync(root,{recursive:true,force:true});});

describe("runtime registry",()=>{
  it("persists multiple versions and returns the latest registered version",async()=>{
    const {registerRuntime,getRuntime,runtimeVersions,runtimeStoreReport}=await import("../../lib/runtime-registry");
    const base={id:"runtime.test",name:"Test Runtime",kind:"CUSTOM" as const,platforms:["linux"],architectures:["x64"],buildCommands:["build"],testCommands:["test"],sandboxSupport:true,networkDefault:"DENY" as const};
    registerRuntime({...base,version:"1"});
    registerRuntime({...base,version:"2"});
    expect(runtimeVersions("runtime.test")).toEqual(["1","2"]);
    expect(getRuntime("runtime.test")?.version).toBe("2");
    expect(getRuntime("runtime.test","1")?.version).toBe("1");
    expect(runtimeStoreReport().ok).toBe(true);
  });

  it("rejects an ALLOWLIST runtime until a controlled egress adapter exists",async()=>{
    const {registerRuntime}=await import("../../lib/runtime-registry");
    expect(()=>registerRuntime({
      id:"runtime.egress",name:"Egress",version:"1",kind:"CUSTOM",platforms:["linux"],architectures:["x64"],
      buildCommands:[],testCommands:[],sandboxSupport:true,networkDefault:"ALLOWLIST"
    })).toThrow(/egress adapter/);
  });
});
