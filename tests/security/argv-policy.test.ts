import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("sec-argv");

let argvPolicy: typeof import("../../lib/argv-policy");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let audit: typeof import("../../lib/audit");

const AGENT = "AG-BUILD";

async function authorizedFixture() {
  const mission = cp.createMission({title: "argv", objective: "Shell-Strings verbieten", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "argv-Task", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
  const sandbox = await fabric.createSandbox({type: "security", taskId: task.taskId, agentId: AGENT, risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const issued = authority.issueCapabilityToken({
    subject: AGENT,
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    environment: "development",
    capabilities: ["task:execute", "sandbox:run"],
    risk: "LOW",
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  });
  return {task, sandbox, token: issued.token};
}

async function denyCheck(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof broker.ExecutionDeniedError) return error.check;
    throw error;
  }
  throw new Error("erwartete Verweigerung blieb aus");
}

beforeAll(async () => {
  vi.resetModules();
  argvPolicy = await import("../../lib/argv-policy");
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("argv-Policy (keine Shell-Strings)", () => {
  it("erkennt Shell-Interpreter inklusive Pfad und .exe", () => {
    for (const program of ["sh", "bash", "/bin/bash", "/usr/bin/zsh", "POWERSHELL.EXE", "wsl"]) {
      expect(argvPolicy.isShellInterpreter(program)).toBe(true);
    }
    expect(argvPolicy.isShellInterpreter("node")).toBe(false);
    expect(argvPolicy.isShellInterpreter("./run.sh")).toBe(false);
  });

  it("findet Metazeichen in jedem Argument, nicht nur in argv[0]", () => {
    expect(argvPolicy.firstMetacharacterArg(["node", "-e", "ok"])).toBeNull();
    expect(argvPolicy.firstMetacharacterArg(["node", "-e", "a; rm -rf /"])).toBe(2);
    expect(argvPolicy.firstMetacharacterArg(["node", "-e", "echo $(id)"])).toBe(2);
  });

  it("meldet leere, ungültige und zu lange Argumente", () => {
    expect(argvPolicy.argvViolation([])).toMatch(/must not be empty/);
    expect(argvPolicy.argvViolation(["node", ""])).toMatch(/invalid argv entry/);
    expect(argvPolicy.argvViolation(["node", "x".repeat(argvPolicy.MAX_ARGV_LENGTH + 1)])).toMatch(/too long/);
    expect(() => argvPolicy.assertArgvPolicy(["sh", "-c", "id"])).toThrow();
    expect(() => argvPolicy.assertArgvPolicy(["node", "-e", "ok"])).not.toThrow();
  });

  it("verweigert Shell-Interpreter im Broker mit auditiertem DENY", async () => {
    const {task, sandbox, token} = await authorizedFixture();
    const check = await denyCheck(() =>
      broker.executeAuthorized({
        taskId: task.taskId,
        agentId: AGENT,
        sandboxId: sandbox.sandboxId,
        capabilityTokenId: token.id,
        environment: "development",
        argv: ["/bin/sh", "-c", "id"]
      })
    );
    expect(check).toBe("SHELL_PROGRAM");
    expect(audit.auditSnapshot(200).some(record => record.decision === "DENY" && record.action === "sandbox.execute")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("verweigert Shell-Metazeichen im Broker", async () => {
    const {task, sandbox, token} = await authorizedFixture();
    const check = await denyCheck(() =>
      broker.executeAuthorized({
        taskId: task.taskId,
        agentId: AGENT,
        sandboxId: sandbox.sandboxId,
        capabilityTokenId: token.id,
        environment: "development",
        argv: ["node", "-e", "process.exit(0); process.exit(1)"]
      })
    );
    expect(check).toBe("SHELL_METACHAR");
  });

  it("erzwingt die Policy zusätzlich in der lokalen Runtime (Defense in Depth)", async () => {
    const {sandbox} = await authorizedFixture();
    const factory = await import("../../lib/runtime-factory");
    expect(factory.runtimeHandle(sandbox.sandboxId)).not.toBeNull();
    // Direkter Runtime-Aufruf muss dieselbe Policy durchsetzen wie der Broker.
    await expect(factory.activeSandboxRuntime.execute(sandbox.sandboxId, ["bash", "-c", "id"])).rejects.toThrow(
      /shell interpreter/
    );
    await expect(factory.activeSandboxRuntime.execute(sandbox.sandboxId, ["node", "-e", "a`b"])).rejects.toThrow(/metacharacters/);
    // Zulässiges argv bleibt ausführbar.
    const ok = await factory.activeSandboxRuntime.execute(sandbox.sandboxId, ["node", "-e", "process.stdout.write('rt-ok')"]);
    expect(ok.accepted).toBe(true);
    expect(ok.stdout).toContain("rt-ok");
  });
});
