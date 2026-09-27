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
  it("exportiert und importiert ein lokal verifiziertes Bundle herkunftstreu",async()=>{
    const source=path.join(root,"package.tgz");fs.writeFileSync(source,"package-content");
    const f=await import("../../lib/offline-fabric");
    const r=f.verifyOfflineResource(f.registerOfflineResource({kind:"PACKAGE",name:"pkg",location:source,metadata:{origin:"local"}}).id);
    const bundleDir=path.join(root,"bundle-outside");
    const bundle=f.exportOfflineBundle([r.id],bundleDir);
    expect(bundle.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const importedRoot=fs.mkdtempSync(path.join(os.tmpdir(),"bob-import-"));
    process.env.BOB_STORAGE_DIR=importedRoot;
    vi.resetModules();
    const imported=await import("../../lib/offline-fabric");
    expect(imported.importOfflineBundle(bundleDir).imported).toContain(r.id);
    expect(imported.verifyOfflineResource(r.id).verified).toBe(true);
    fs.writeFileSync(path.join(bundleDir,`${r.id}.resource`),"tampered");
    expect(()=>imported.importOfflineBundle(bundleDir)).toThrow(/digest mismatch/);
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
