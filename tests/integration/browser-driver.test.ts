import {describe,expect,it} from "vitest";

describe("CDP browser driver",()=>{
  it("fails closed when no browser executable is configured",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    delete process.env.BOB_BROWSER_EXECUTABLE;
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"http://example.test"})).rejects.toThrow(/BOB_BROWSER_EXECUTABLE/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
  it("rejects unsupported or unsafe navigation input before browser launch",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    process.env.BOB_BROWSER_EXECUTABLE="/usr/bin/chromium";
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"javascript:alert(1)"})).rejects.toThrow(/http\(s\)/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
});
