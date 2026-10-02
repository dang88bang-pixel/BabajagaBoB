import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("int-computer-use");

let computers: typeof import("../../lib/computer-use");
let route: typeof import("../../app/api/computer-use/route");

beforeAll(async () => {
  vi.resetModules();
  computers = await import("../../lib/computer-use");
  route = await import("../../app/api/computer-use/route");
});

describe("Computer Use (Discovery ≠ Autorisierung)", () => {
  it("liefert keinen vorautorisierten Computer aus", () => {
    const list = computers.listComputers();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every(instance => instance.authorized === false)).toBe(true);
    expect(list.every(instance => instance.network !== "INTERNET")).toBe(true);
  });

  it("verweigert Allocation ohne Autorisierung und erlaubt sie nach Creator-Freigabe", () => {
    const instance = computers.listComputers()[0];
    expect(() => computers.allocateComputer(instance.id, "TASK-X")).toThrow(/not authorized/);
    const authorized = computers.authorizeComputer(instance.id, true, "CREATOR");
    expect(authorized.authorized).toBe(true);
    const allocated = computers.allocateComputer(instance.id, "TASK-X", "SB-X");
    expect(allocated.state).toBe("ALLOCATED");
    // Start erst nach Allocation, Freigabe setzt den Zustand zurück.
    expect(computers.startComputer(instance.id).state).toBe("EXECUTING");
    const released = computers.releaseComputer(instance.id);
    expect(released.state).toBe("RELEASED");
    expect(released.taskId).toBeUndefined();
    // Autorisierung kann entzogen werden – danach ist keine Allocation mehr möglich.
    computers.authorizeComputer(instance.id, false, "CREATOR");
    expect(() => computers.allocateComputer(instance.id, "TASK-Y")).toThrow(/not authorized/);
  });

  it("verwirft eine Autorisierung, die über die Registrierung mitkommt", () => {
    // Gefundener Fehler: `registerComputer` übernahm `authorized: true` aus dem
    // Aufruf. Ein so autorisierter Computer hatte keinen
    // `computer.authorized`-Nachweis in der Audit-Kette — die Autorisierung war
    // damit nicht nachvollziehbar (Discovery ≠ Autorisierung).
    const registered = computers.registerComputer({
      name: "Direkt autorisiert",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}],
      authorized: true
    });
    expect(registered.authorized).toBe(false);
    expect(() => computers.allocateComputer(registered.id, "TASK-DIRECT")).toThrow(/not authorized/);

    // Autorisierung wirkt ausschließlich über den expliziten Creator-Akt …
    expect(computers.authorizeComputer(registered.id, true, "CREATOR").authorized).toBe(true);
    expect(computers.allocateComputer(registered.id, "TASK-DIRECT").state).toBe("ALLOCATED");
    // … und nur der Creator darf sie erteilen.
    expect(() => computers.authorizeComputer(registered.id, true, "AG-QA")).toThrow(/Creator/);
  });

  it("bindet die Route an Autorisierung (Registrieren/Autorisieren ist Creator-Sache)", async () => {
    const unauthenticated = await route.GET(new Request("http://localhost:3000/api/computer-use"));
    expect([401, 428]).toContain(unauthenticated.status);
  });

  it("führt Creator-Ausführung über die Route mit serverseitigem Einmal-Token durch", async () => {
    process.env.BOB_NS_ISOLATION = "off";
    const auth = await import("../../app/api/auth/route");
    const bootstrap = await auth.POST(new Request("http://localhost:3000/api/auth", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer Route Test"})
    }));
    expect(bootstrap.status).toBe(201);
    const cookie = (bootstrap.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^bob_session=/);

    const control = await import("../../lib/control-plane");
    const fabric = await import("../../lib/sandbox/fabric");
    const authority = await import("../../lib/authority");
    const mission = control.createMission({title: "Computer Route", objective: "Brokered API execution", createdBy: "CREATOR"});
    const task = control.createTask({missionId: mission.missionId, title: "Route screenshot", risk: "LOW", assignedAgent: "AG-BROWSER", createdBy: "CREATOR"});
    const sandbox = await fabric.createSandbox({type: "browser", taskId: task.taskId, agentId: "AG-BROWSER", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const computer = computers.registerComputer({
      name: "Route Browser",
      kind: "BROWSER",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "BROWSER", actions: ["SCREENSHOT"], environments: ["browser"], network: "DENY", risk: "LOW"}],
      authorized: false
    });
    const post = (body: Record<string, unknown>) => route.POST(new Request("http://localhost:3000/api/computer-use", {
      method: "POST",
      headers: {"content-type": "application/json", cookie},
      body: JSON.stringify(body)
    }));

    const authorization = await post({action: "authorize", id: computer.id, authorized: true});
    expect(authorization.status).toBe(200);
    const allocation = await post({action: "allocate", id: computer.id, taskId: task.taskId, sandboxId: sandbox.sandboxId});
    expect(allocation.status).toBe(200);

    const driverRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-computer-route-driver-"));
    const driverPath = path.join(driverRoot, "driver.mjs");
    fs.writeFileSync(driverPath, 'let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",chunk=>input+=chunk); process.stdin.on("end",()=>{const request=JSON.parse(input); process.stdout.write(JSON.stringify({ok:true,action:request.action}));});');
    fs.chmodSync(driverPath, 0o700);
    const previousDriver = process.env.BOB_COMPUTER_DRIVER;
    process.env.BOB_COMPUTER_DRIVER = driverPath;
    try {
      const response = await post({action: "execute", computerId: computer.id, computerAction: "SCREENSHOT", computerInput: {target: "main"}});
      expect(response.status).toBe(200);
      const result = await response.json() as Record<string, unknown>;
      expect(result.status).toBe("SUCCEEDED");
      expect(result.accepted).toBe(true);
      expect(result.output).toEqual({ok: true, action: "SCREENSHOT"});
      expect(result).not.toHaveProperty("capabilityTokenId");
      expect(result).not.toHaveProperty("token");
      const issued = authority.capabilityTokens().find(token => token.subject === "AG-BROWSER" && token.taskId === task.taskId && token.capabilities.includes("computer:execute"));
      expect(issued?.uses).toBe(1);
      expect(issued?.maxUses).toBe(1);
    } finally {
      if (previousDriver === undefined) delete process.env.BOB_COMPUTER_DRIVER;
      else process.env.BOB_COMPUTER_DRIVER = previousDriver;
      delete process.env.BOB_NS_ISOLATION;
    }
  });
});


describe("Device scheduling", () => {
  it("wählt nur autorisierte, verfügbare Geräte und berücksichtigt Ressourcen", async () => {
    const devices = await import("../../lib/devices");
    const first = devices.listDevices()[0];
    if (first.authorized) devices.authorizeDevice(first.id, false, "CREATOR");
    const discovered = devices.discoverDevice({id:"DEV-SCHED-1",name:"Scheduler Test",os:"linux",arch:"x64",cpu:16,ramMb:32768,gpu:"none",network:"NONE",trust:"MANAGED",capabilities:["node","python"],lastSeen:new Date().toISOString()});
    expect(discovered.authorized).toBe(false);
    devices.authorizeDevice(discovered.id,true,"CREATOR");
    const allocated = devices.scheduleDevice("TASK-SCHED",{cpu:8,ramMb:4096,os:"linux",arch:"x64",capabilities:["python"],network:"NONE"});
    expect(allocated.id).toBe(discovered.id);
    expect(allocated.currentTaskId).toBe("TASK-SCHED");
  });

  it("verweigert Scheduling ohne passende autorisierte Kapazität", async () => {
    const devices = await import("../../lib/devices");
    expect(() => devices.scheduleDevice("TASK-NO-GPU",{gpu:"RTX-UNAVAILABLE"})).toThrow(/no authorized device/);
  });
});
