import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Umfang der Capability an der Ausführungsschicht (Abschnitt 10/12, TEST-004).
 *
 * Diese Datei schließt Lücken, die die Sabotageproben (`scripts/sabotage.mjs`)
 * aufgedeckt haben: Die Sicherheitssuiten prüften bisher, **dass** eine
 * Ausführung verweigert wird, aber nicht **warum**. Ein entferntes Prüfkriterium
 * blieb dadurch unbemerkt (die Verweigerung kam aus einer anderen Prüfung).
 *
 * Deshalb wird hier an der Ausführungsschicht (Broker) geprüft und jeweils das
 * konkrete Kriterium benannt:
 *  1. Token ohne die geforderte Fähigkeit → `TOKEN_VALIDATION`
 *  2. abgelaufenes Token             → `TOKEN_VALIDATION`
 *  3. Risk-Scope kleiner als die Task → `TOKEN_RISK`
 *
 * Zu jeder Verweigerung gehört der Audit-Nachweis (DENY) — eine Verweigerung
 * ohne Spur wäre im Nachweis unbrauchbar.
 */

isolatedStorageRoot("sec-broker-scope");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let audit: typeof import("../../lib/audit");

const AGENT = "AG-BUILD";
const OK_ARGV = ["node", "-e", "process.stdout.write('scope-ok')"];

type Fixture = {
  taskId: string;
  sandboxId: string;
  tokenId: string;
};

async function fixture(input: {taskRisk: "LOW" | "MODERATE"; tokenRisk: "LOW" | "MODERATE"; capabilities: string[]; ttlMs?: number}): Promise<Fixture> {
  const mission = cp.createMission({title: "Umfang", objective: "Capability-Umfang", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "Umfangs-Task", risk: input.taskRisk, assignedAgent: AGENT, createdBy: "CREATOR"});
  const sandbox = await fabric.createSandbox({type: "security", taskId: task.taskId, agentId: AGENT, risk: input.taskRisk});
  await fabric.startSandbox(sandbox.sandboxId);
  const issued = authority.issueCapabilityToken({
    subject: AGENT,
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    environment: "development",
    capabilities: input.capabilities,
    risk: input.tokenRisk,
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR",
    expiresAt: new Date(Date.now() + (input.ttlMs ?? 5 * 60_000)).toISOString()
  });
  return {taskId: task.taskId, sandboxId: sandbox.sandboxId, tokenId: issued.token.id};
}

async function denyCheck(target: Fixture): Promise<string> {
  try {
    await broker.executeAuthorized({
      taskId: target.taskId,
      agentId: AGENT,
      sandboxId: target.sandboxId,
      capabilityTokenId: target.tokenId,
      environment: "development",
      argv: OK_ARGV
    });
  } catch (error) {
    if (error instanceof broker.ExecutionDeniedError) return error.check;
    throw error;
  }
  throw new Error("erwartete Verweigerung blieb aus");
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Capability-Umfang an der Ausführungsschicht", () => {
  it("verweigert ein Token ohne die geforderte Fähigkeit (TOKEN_VALIDATION)", async () => {
    // `sandbox:run` fehlt: Das Token deckt nur die Task-Ausführung, nicht den
    // Lauf in der Sandbox.
    const target = await fixture({taskRisk: "LOW", tokenRisk: "LOW", capabilities: ["task:execute"]});
    expect(await denyCheck(target)).toBe("TOKEN_VALIDATION");
    expect(
      audit.auditSnapshot(200).some(record => record.action === "sandbox.execute" && record.decision === "DENY")
    ).toBe(true);
  });

  it("verweigert ein abgelaufenes Token an der Ausführungsschicht", async () => {
    // Kurze, aber gültige Frist: Das Token ist bei der Ausstellung gültig und
    // beim Aufruf abgelaufen — genau der Fall, den ein „Vorrats-Token\" erzeugt.
    const target = await fixture({taskRisk: "LOW", tokenRisk: "LOW", capabilities: ["task:execute", "sandbox:run"], ttlMs: 300});
    await new Promise(resolve => setTimeout(resolve, 1_000));
    expect(await denyCheck(target)).toBe("TOKEN_VALIDATION");
  });

  it("verweigert einen Risk-Scope, der die Task nicht deckt", async () => {
    // Der Agent darf MODERATE-Arbeit (maxRisk HIGH), das Token deckt sie nicht:
    // Die Ausführungsschicht darf sich nicht auf den Agenten statt auf das
    // Token verlassen.
    //
    // Der Umfang wird an zwei Stellen geprüft (Token-Validierung **und** Broker
    // als zweite Instanz). Geprüft wird deshalb die Zusage — verweigert, und
    // zwar wegen des Risk-Umfangs — nicht ein einzelner Prüfcode; sonst wäre
    // der Test an defense-in-depth gekoppelt statt an das Verhalten.
    const target = await fixture({taskRisk: "MODERATE", tokenRisk: "LOW", capabilities: ["task:execute", "sandbox:run"]});
    try {
      await broker.executeAuthorized({
        taskId: target.taskId,
        agentId: AGENT,
        sandboxId: target.sandboxId,
        capabilityTokenId: target.tokenId,
        environment: "development",
        argv: OK_ARGV
      });
      throw new Error("erwartete Verweigerung blieb aus");
    } catch (error) {
      expect(error).toBeInstanceOf(broker.ExecutionDeniedError);
      const denied = error as InstanceType<typeof broker.ExecutionDeniedError>;
      expect(["TOKEN_VALIDATION", "TOKEN_RISK"]).toContain(denied.check);
      expect(denied.message).toMatch(/risk scope/i);
    }
  });

  it("lässt den gedeckten Fall weiterhin zu (Gegenprobe)", async () => {
    const target = await fixture({taskRisk: "LOW", tokenRisk: "LOW", capabilities: ["task:execute", "sandbox:run"]});
    const result = await broker.executeAuthorized({
      taskId: target.taskId,
      agentId: AGENT,
      sandboxId: target.sandboxId,
      capabilityTokenId: target.tokenId,
      environment: "development",
      argv: OK_ARGV
    });
    expect(result.accepted).toBe(true);
    expect(result.stdout).toContain("scope-ok");
  });
});
