import {describe,expect,it} from "vitest";

describe("CDP browser driver",()=>{
  it("fails closed when no browser executable is configured",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    delete process.env.BOB_BROWSER_EXECUTABLE;
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"http://example.test"})).rejects.toThrow(/BOB_BROWSER_EXECUTABLE/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
  it("executes a real headless browser screenshot when CI provides Chromium",async()=>{\n    if(!process.env.BOB_BROWSER_EXECUTABLE) return;\n    const {executeBrowserAction}=await import("../../lib/browser-driver");\n    const result=await executeBrowserAction("SCREENSHOT",{});\n    expect(result.ok).toBe(true);\n    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);\n    expect(result.bytes).toBeGreaterThan(100);\n  });\n  it("rejects unsupported or unsafe navigation input before browser launch",async()=>{
    const old=process.env.BOB_BROWSER_EXECUTABLE;
    process.env.BOB_BROWSER_EXECUTABLE="/usr/bin/chromium";
    const {executeBrowserAction}=await import("../../lib/browser-driver");
    await expect(executeBrowserAction("NAVIGATE",{url:"javascript:alert(1)"})).rejects.toThrow(/http\(s\)/);
    if(old===undefined) delete process.env.BOB_BROWSER_EXECUTABLE; else process.env.BOB_BROWSER_EXECUTABLE=old;
  });
});
