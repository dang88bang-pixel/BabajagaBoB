import {describe, expect, it} from "vitest";
import {classifyRecoveryTier} from "../../lib/recovery-tier";

/**
 * Recovery-Stufen werden abgeleitet, nicht geraten. Jede Stufe ist begründet
 * (`reasons`) und Stufe 4/5 verlangt ausdrücklich eine Creator-Freigabe.
 */
describe("Recovery-Tier-Klassifikation", () => {
  it("wählt Stufe 1, wenn weder Ursache noch Eingriffsweg belegt sind", () => {
    const classification = classifyRecoveryTier({severity: "LOW", symptom: "vereinzelter Timeout", hasCheckpoint: false, hasDiagnosticSandbox: false});
    expect(classification.tier).toBe(1);
    expect(classification.requiresCreatorApproval).toBe(false);
    expect(classification.reasons.join(" ")).toMatch(/kein Eingriffsweg|kein Checkpoint/);
    expect(classification.steps.length).toBeGreaterThan(0);
  });

  it("wählt Stufe 2 für einen reproduzierbaren Fehllauf mit Checkpoint", () => {
    const classification = classifyRecoveryTier({
      severity: "MEDIUM",
      symptom: "Prozess endet mit Exit-Code 7",
      failureMode: "Reproduzierbarer Fehllauf im Lauf",
      hasCheckpoint: true,
      hasDiagnosticSandbox: true
    });
    expect(classification.tier).toBe(2);
    expect(classification.requiresCreatorApproval).toBe(false);
    expect(classification.reasons.join(" ")).toMatch(/Checkpoint|Reproduzierbar|reproduzierbar/);
    // "Exit-Code" darf nicht als Codefix fehlinterpretiert werden.
    expect(classification.reasons.join(" ")).not.toMatch(/Artefakt|Code/);
  });

  it("eskaliert auf Stufe 3 bei Umgebungsbezug oder fehlendem Checkpoint", () => {
    const environment = classifyRecoveryTier({
      severity: "MEDIUM",
      symptom: "Workspace beschädigt",
      failureMode: "Ressourcenfehler in der Sandbox",
      hasCheckpoint: true,
      hasDiagnosticSandbox: true
    });
    expect(environment.tier).toBe(3);
    const noCheckpoint = classifyRecoveryTier({
      severity: "LOW",
      symptom: "Fehllauf ohne Snapshot",
      rootCause: "Ursache nicht bestimmt",
      hasCheckpoint: false,
      hasDiagnosticSandbox: true
    });
    expect(noCheckpoint.tier).toBe(3);
    expect(noCheckpoint.reasons.join(" ")).toMatch(/Checkpoint/);
  });

  it("wählt Stufe 4 bei Ursache im Code und verlangt Creator-Freigabe", () => {
    const classification = classifyRecoveryTier({
      severity: "HIGH",
      failureMode: "Nicht behandelte Ausnahme im Artefakt",
      rootCause: "Fehlerbehandlung im Code fehlt",
      symptom: "Prozess bricht ab",
      hasCheckpoint: true,
      hasDiagnosticSandbox: true
    });
    expect(classification.tier).toBe(4);
    expect(classification.requiresCreatorApproval).toBe(true);
    expect(classification.steps.join(" ")).toMatch(/Artefakt korrigieren/);
  });

  it("wählt Stufe 5 bei Sicherheitsbefund, CRITICAL oder Strukturhinweis", () => {
    expect(classifyRecoveryTier({severity: "HIGH", securityRelated: true, hasCheckpoint: true, hasDiagnosticSandbox: true}).tier).toBe(5);
    expect(classifyRecoveryTier({severity: "CRITICAL", hasCheckpoint: true, hasDiagnosticSandbox: true}).tier).toBe(5);
    const structure = classifyRecoveryTier({
      severity: "MEDIUM",
      symptom: "Task-Struktur inkonsistent",
      rootCause: "Task falsch zugeordnet",
      hasCheckpoint: true,
      hasDiagnosticSandbox: true
    });
    expect(structure.tier).toBe(5);
    expect(structure.requiresCreatorApproval).toBe(true);
  });

  it("liefert für jede Stufe einen nachvollziehbaren Plan", () => {
    for (const severity of ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) {
      const classification = classifyRecoveryTier({severity, hasCheckpoint: true, hasDiagnosticSandbox: true});
      expect(classification.reasons.length).toBeGreaterThan(0);
      expect(classification.steps.length).toBeGreaterThan(1);
      expect(classification.requiresCreatorApproval).toBe(classification.tier >= 4);
    }
  });
});
