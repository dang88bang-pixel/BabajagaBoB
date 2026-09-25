import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Promotion-Gates (Abschnitt 24/40/41, TEST-004).
 *
 * Diese Suite sichert die Regeln, an denen ein Rollout **scheitern muss**.
 * Der Anlass ist konkret: Der Sabotagelauf (`scripts/sabotage.mjs`) hat gezeigt,
 * dass ein geschwächtes Freigabe-Gate und ein geöffnetes Staging-Gate von der
 * damaligen Testlage **nicht** bemerkt wurden. Jede Zusicherung hier ist so
 * formuliert, dass sie bei entfernter Regel rot wird — also nicht „irgendetwas
 * wirft", sondern der benannte Grund.
 */

let root = "";
let source = "";

function writeBuild(buildId: string) {
  fs.mkdirSync(path.join(source, ".next"), {recursive: true});
  fs.writeFileSync(path.join(source, ".next", "BUILD_ID"), `${buildId}\n`);
  fs.writeFileSync(path.join(source, ".next", "server.js"), `// ${buildId}\n`);
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({name: "bob-gate-test"}));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-gates-"));
  source = path.join(root, "app");
  writeBuild("BUILD-GATES");
  process.env.BOB_STORAGE_DIR = path.join(root, "data");
  process.env.BOB_RELEASE_DIR = path.join(root, "releases");
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOB_RELEASE_DIR;
  fs.rmSync(root, {recursive: true, force: true});
});

const MANDATORY = ["LINT", "TYPECHECK", "UNIT", "INTEGRATION", "SECURITY", "BUILD"] as const;
const NON_MANDATORY = ["BROWSER", "EVALUATION"] as const;

type Modules = {
  cicd: typeof import("../../lib/cicd");
  approvals: typeof import("../../lib/approvals");
  governance: typeof import("../../lib/governance");
  promotion: typeof import("../../lib/promotion");
  deployment: typeof import("../../lib/deployment");
  release: typeof import("../../lib/release");
  cp: typeof import("../../lib/control-plane");
};

async function modules(): Promise<Modules> {
  return {
    cicd: await import("../../lib/cicd"),
    approvals: await import("../../lib/approvals"),
    governance: await import("../../lib/governance"),
    promotion: await import("../../lib/promotion"),
    deployment: await import("../../lib/deployment"),
    release: await import("../../lib/release"),
    cp: await import("../../lib/control-plane")
  };
}

async function makeTask(cp: Modules["cp"]) {
  const mission = cp.createMission({title: "Gates", objective: "Promotion-Gates prüfen", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "Gates", description: "Promotion"});
  return cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: "Rollout",
    risk: "LOW",
    assignedAgent: "AG-OPS",
    createdBy: "CREATOR"
  });
}

function makeApproval(approvals: Modules["approvals"], taskId: string, granted: boolean) {
  const approval = approvals.createApproval({
    taskId,
    requestedBy: "AG-OPS",
    changeSummary: "Ausrollen",
    why: "Gate-Test",
    expectedEffect: "Neuer Stand wird ausgeliefert",
    risks: ["kurze Nichtverfügbarkeit"],
    testResults: ["Suiten grün"],
    rollbackPlan: "Zeiger zurückstellen",
    files: ["lib/deployment.ts"],
    dbChanges: [],
    networkEffects: [],
    affectedSystems: ["platform"]
  });
  if (granted) approvals.resolveApprovalRequest(approval.approvalId, "GRANTED", "CREATOR");
  return approval;
}

describe("Promotion-Gate: Produktion ist ohne vollständigen Nachweis nicht erreichbar", () => {
  it("verweigert Produktion, solange eine Prüfung nicht PASSED ist", async () => {
    const {cicd, approvals, promotion, cp} = await modules();
    const task = await makeTask(cp);
    const approval = makeApproval(approvals, task.taskId, true);
    const pipeline = cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: approval.approvalId});
    for (const kind of MANDATORY) cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    cicd.updateCheck(pipeline.id, "BROWSER", "SKIPPED", "kein Browser verfügbar");
    // EVALUATION bleibt bewusst PENDING.
    cicd.promote(pipeline.id, "STAGING");
    cicd.promote(pipeline.id, "SMOKE");

    const gate = promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION");
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(" ")).toContain("verification checks incomplete");
  });

  it("verweigert Produktion ohne Freigabe-Referenz und ohne erteilte Freigabe", async () => {
    const {cicd, approvals, promotion, cp} = await modules();
    const task = await makeTask(cp);
    const pending = makeApproval(approvals, task.taskId, false);
    const pipeline = cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: pending.approvalId});
    for (const kind of [...MANDATORY, ...NON_MANDATORY]) cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    cicd.promote(pipeline.id, "STAGING");
    cicd.promote(pipeline.id, "SMOKE");

    // Eine offene (nicht gewährte) Freigabe ist keine Freigabe.
    const withPending = promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION");
    expect(withPending.allowed).toBe(false);
    expect(withPending.reasons.join(" ")).toContain("production approval required");
    expect(approvals.approvalGranted(pending.approvalId)).toBe(false);

    // Ohne Referenz ebenso wenig.
    const noReference = cicd.createPipeline({taskId: task.taskId, branch: "main"});
    for (const kind of [...MANDATORY, ...NON_MANDATORY]) cicd.updateCheck(noReference.id, kind, "PASSED", `${kind} grün`);
    cicd.promote(noReference.id, "STAGING");
    cicd.promote(noReference.id, "SMOKE");
    const withoutApproval = promotion.promotionGate(cicd.getPipeline(noReference.id)!, "PRODUCTION");
    expect(withoutApproval.allowed).toBe(false);
    expect(withoutApproval.reasons.join(" ")).toContain("production approval required");

    // Erst die gewährte Freigabe öffnet den Produktionspfad.
    approvals.resolveApprovalRequest(pending.approvalId, "GRANTED", "CREATOR");
    const granted = promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION");
    expect(granted.allowed, granted.reasons.join("; ")).toBe(true);
  });

  it("verweigert Produktion, wenn die Smoke-Stufe nicht erreicht ist", async () => {
    const {cicd, approvals, promotion, cp} = await modules();
    const task = await makeTask(cp);
    const approval = makeApproval(approvals, task.taskId, true);
    const pipeline = cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: approval.approvalId});
    for (const kind of [...MANDATORY, ...NON_MANDATORY]) cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    cicd.promote(pipeline.id, "STAGING");

    const gate = promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION");
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(" ")).toContain("smoke stage required");
  });

  it("verweigert jede Promotion bei aktivem Deployment-Kill-Switch", async () => {
    const {cicd, approvals, promotion, governance, cp} = await modules();
    const task = await makeTask(cp);
    const approval = makeApproval(approvals, task.taskId, true);
    const pipeline = cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: approval.approvalId});
    for (const kind of [...MANDATORY, ...NON_MANDATORY]) cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    cicd.promote(pipeline.id, "STAGING");
    cicd.promote(pipeline.id, "SMOKE");
    expect(promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION").allowed).toBe(true);

    governance.setKillSwitch("DEPLOYMENT", pipeline.id, true, "Notbremse im Gate-Test", "CREATOR");
    try {
      const killing = promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION");
      expect(killing.allowed).toBe(false);
      expect(killing.reasons.join(" ")).toContain("deployment kill-switch active");
      expect(governance.isKilled("DEPLOYMENT", pipeline.id)).toBe(true);
    } finally {
      governance.setKillSwitch("DEPLOYMENT", pipeline.id, false, "Notbremse im Gate-Test aufgehoben", "CREATOR");
    }
    expect(promotion.promotionGate(cicd.getPipeline(pipeline.id)!, "PRODUCTION").allowed).toBe(true);
  });
});

describe("Staging-Gate: Lücken sind erlaubt, aber nur benannt", () => {
  async function planFor(mods: Modules, pipelineId: string, target: "STAGING" | "PRODUCTION" = "STAGING") {
    const manifest = mods.release.prepareRelease({source, label: `gates-${pipelineId}`});
    return mods.deployment.planDeployment({releaseId: manifest.releaseId, pipelineId, approvalId: mods.approvals.listApprovals()[0]?.approvalId, target});
  }

  async function stagedPipeline(mods: Modules, options: {stage?: "BUILD" | "STAGING"; skipWithReason?: boolean} = {}) {
    const task = await makeTask(mods.cp);
    const approval = makeApproval(mods.approvals, task.taskId, true);
    const pipeline = mods.cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: approval.approvalId});
    for (const kind of MANDATORY) mods.cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    if (options.skipWithReason !== undefined) {
      for (const kind of NON_MANDATORY) mods.cicd.updateCheck(pipeline.id, kind, "SKIPPED", options.skipWithReason ? "läuft hier nicht real" : "");
      // Der Smoke-Test ist kein Pflichtcheck für Staging, aber er darf nicht
      // offen (PENDING) stehen bleiben — offene Prüfungen blockieren immer.
      mods.cicd.updateCheck(pipeline.id, "SMOKE", "PASSED", "Smoke-Prüfungen grün");
    }
    if (options.stage !== "BUILD") mods.cicd.promote(pipeline.id, "STAGING");
    return {pipelineId: pipeline.id, approvalId: approval.approvalId};
  }

  it("verweigert Staging aus einer nicht promovierten Stufe", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {stage: "BUILD", skipWithReason: true});
    const plan = await planFor(mods, pipelineId);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("staging requires a promoted stage");
  });

  it("verweigert Staging, solange eine Pflichtprüfung fehlt, und benennt sie", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {skipWithReason: true});
    mods.cicd.updateCheck(pipelineId, "UNIT", "PENDING", "");
    const plan = await planFor(mods, pipelineId);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("verification checks incomplete (UNIT=PENDING)");
  });

  it("verweigert eine übersprungene Prüfung ohne Begründung", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {skipWithReason: false});
    const plan = await planFor(mods, pipelineId);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("BROWSER skipped without reason");
    expect(plan.acknowledgedGaps).toHaveLength(0);
  });

  it("erlaubt Staging mit quittierten Lücken und führt sie sichtbar", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {skipWithReason: true});
    const plan = await planFor(mods, pipelineId);
    expect(plan.allowed, plan.reasons.join("; ")).toBe(true);
    expect(plan.acknowledgedGaps.join(" ")).toContain("BROWSER: läuft hier nicht real");
    expect(plan.acknowledgedGaps.join(" ")).toContain("EVALUATION: läuft hier nicht real");
  });

  it("verweigert Staging ohne erteilte Freigabe", async () => {
    const mods = await modules();
    const task = await makeTask(mods.cp);
    const pending = makeApproval(mods.approvals, task.taskId, false);
    const pipeline = mods.cicd.createPipeline({taskId: task.taskId, branch: "main", approvalId: pending.approvalId});
    for (const kind of MANDATORY) mods.cicd.updateCheck(pipeline.id, kind, "PASSED", `${kind} grün`);
    for (const kind of NON_MANDATORY) mods.cicd.updateCheck(pipeline.id, kind, "SKIPPED", "läuft hier nicht real");
    mods.cicd.promote(pipeline.id, "STAGING");

    const manifest = mods.release.prepareRelease({source, label: "pending-approval"});
    const withPending = mods.deployment.planDeployment({releaseId: manifest.releaseId, pipelineId: pipeline.id, approvalId: pending.approvalId, target: "STAGING"});
    expect(withPending.allowed).toBe(false);
    expect(withPending.reasons.join(" ")).toContain(`approval ${pending.approvalId} is not granted`);

    const withoutApproval = mods.deployment.planDeployment({releaseId: manifest.releaseId, pipelineId: pipeline.id, target: "STAGING"});
    expect(withoutApproval.allowed).toBe(false);
    expect(withoutApproval.reasons.join(" ")).toContain("creator approval required");
  });

  it("blockiert Staging bei aktivem Deployment-Kill-Switch auf dem Release", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {skipWithReason: true});
    const manifest = mods.release.prepareRelease({source, label: "kill-switch"});
    mods.governance.setKillSwitch("DEPLOYMENT", manifest.releaseId, true, "Rollout stoppen", "CREATOR");
    try {
      const plan = mods.deployment.planDeployment({releaseId: manifest.releaseId, pipelineId, approvalId: mods.approvals.listApprovals()[0]?.approvalId, target: "STAGING"});
      expect(plan.allowed).toBe(false);
      expect(plan.reasons.join(" ")).toContain("deployment kill-switch active");
    } finally {
      mods.governance.setKillSwitch("DEPLOYMENT", manifest.releaseId, false, "Rollout wieder erlaubt", "CREATOR");
    }
  });

  it("verweigert Produktion in dieser Umgebung dauerhaft und benennt die Blocker", async () => {
    const mods = await modules();
    const {pipelineId} = await stagedPipeline(mods, {skipWithReason: true});
    mods.cicd.promote(pipelineId, "SMOKE");
    mods.cicd.updateCheck(pipelineId, "SMOKE", "PASSED", "Smoke grün");
    const manifest = mods.release.prepareRelease({source, label: "production-blockiert"});
    const plan = mods.deployment.planDeployment({releaseId: manifest.releaseId, pipelineId, approvalId: mods.approvals.listApprovals()[0]?.approvalId, target: "PRODUCTION"});
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(" ")).toContain("verification checks incomplete");
    expect(plan.reasons.join(" ")).toContain("production requires all checks PASSED; blocking: BROWSER=SKIPPED, EVALUATION=SKIPPED");
  });
});
