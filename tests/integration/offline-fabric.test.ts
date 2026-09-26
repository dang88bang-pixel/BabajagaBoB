import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it,beforeEach,vi} from "vitest";

describe("offline fabric",()=>{
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-offline-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
  it("registriert und verifiziert lokale Ressourcen per SHA-256",async()=>{
    const file=path.join(root,"model.bin");fs.writeFileSync(file,"offline-data");
    const f=await import("../../lib/offline-fabric");
    const r=f.registerOfflineResource({kind:"MODEL",name:"test-model",location:file,metadata:{scope:"local"}});
    expect(r.verified).toBe(false);
    expect(f.verifyOfflineResource(r.id).verified).toBe(true);
    fs.writeFileSync(file,"tampered");
    expect(()=>f.verifyOfflineResource(r.id)).toThrow(/digest mismatch/);
  });
  it("verweigert Sync für unverifizierte Ressourcen und akzeptiert Digest-verifizierte Syncs",async()=>{
    const file=path.join(root,"doc.md");fs.writeFileSync(file,"hello");
    const f=await import("../../lib/offline-fabric");
    const r=f.registerOfflineResource({kind:"DOCUMENTATION",name:"doc",location:file,metadata:{}});
    expect(()=>f.prepareOfflineSync(r.id,"a".repeat(64))).toThrow(/verified/);
    const verified=f.verifyOfflineResource(r.id);
    const sync=f.prepareOfflineSync(verified.id,"b".repeat(64));
    expect(f.verifyOfflineSync(sync.id,"b".repeat(64)).status).toBe("VERIFIED");
  });
});
