import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it,beforeEach,vi} from "vitest";

describe("Computer Use execution boundary",()=>{
  let root:string;
  beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"bob-computer-"));process.env.BOB_STORAGE_DIR=root;vi.resetModules();});
  it("führt eine autorisierte Aktion über einen echten Child-Process-Driver aus und auditiert nur Digests",async()=>{
    const driver=path.join(root,"driver.mjs");
    fs.writeFileSync(driver,'#!/usr/bin/env node\nlet data=""; process.stdin.on("data",b=>{data+=String(b);}); process.stdin.on("end",()=>{const x=JSON.parse(data); process.stdout.write(JSON.stringify({ok:true,action:x.action}));});');
    fs.chmodSync(driver,0o700);
    process.env.BOB_COMPUTER_DRIVER=driver;
    const computers=await import("../../lib/computer-use");
    const exec=await import("../../lib/computer-driver");
    const c=computers.listComputers()[0];
    computers.authorizeComputer(c.id,true,"CREATOR");
    computers.allocateComputer(c.id,"TASK-CU","SB-CU");
    computers.startComputer(c.id);
    const result=await exec.executeComputerAction({computerId:c.id,action:"SCREENSHOT",input:{url:"http://example.test"}});
    expect(result.status).toBe("SUCCEEDED");
    expect(result.stdoutDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdoutLength).toBeGreaterThan(0);
  });
  it("bleibt ohne Driver fail closed",async()=>{
    delete process.env.BOB_COMPUTER_DRIVER;
    const computers=await import("../../lib/computer-use");
    const exec=await import("../../lib/computer-driver");
    const c=computers.listComputers()[0];
    computers.authorizeComputer(c.id,true,"CREATOR");
    computers.allocateComputer(c.id,"TASK-CU-2");
    computers.startComputer(c.id);
    await expect(exec.executeComputerAction({computerId:c.id,action:"NAVIGATE",input:{url:"http://example.test"}})).rejects.toThrow(/driver is not configured/);
  });
});
