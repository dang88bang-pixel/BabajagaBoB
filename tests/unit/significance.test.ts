import {describe, expect, it} from "vitest";
import {
  assessMeanDifference,
  assessProportionDifference,
  assessSignificance,
  cohensD,
  cohensH,
  erf,
  normalCdf,
  normalQuantile,
  requiredSampleSize,
  twoSidedTPValue,
  twoSidedZPValue
} from "../../lib/significance";

/**
 * Signifikanzprüfung (Abschnitt 15).
 *
 * Geprüft wird hier die Rechengrundlage selbst. Der entscheidende Nachweis ist
 * nicht „der p-Wert ist klein", sondern die Umkehrung: **Ohne ausreichende
 * Daten gibt es keine Aussage** (`significant: null`), und eine zu kleine
 * Stichprobe wird als `INSUFFICIENT` ausgewiesen, auch wenn der p-Wert klein
 * aussieht. Ein Test, der nur „signifikant" abdeckt, wäre wertlos.
 */

describe("Verteilungsfunktionen", () => {
  it("trifft bekannte Werte der Fehlerfunktion und Normalverteilung", () => {
    // An der Nullstelle exakt (Sonderfall im Code — die Näherung allein hätte
    // hier einen Restfehler von ~1e-9, der sich auf Φ(0) übertragen würde).
    expect(erf(0)).toBe(0);
    // A&S 7.1.26 ist auf ≤1,5e-7 genau; geprüft wird genau diese Schranke.
    expect(Math.abs(erf(1) - 0.8427007929497149)).toBeLessThan(1.5e-7);
    expect(erf(-1)).toBeCloseTo(-erf(1), 12);
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("bildet z-Werte auf zweiseitige p-Werte ab", () => {
    expect(twoSidedZPValue(0)).toBeCloseTo(1, 10);
    expect(twoSidedZPValue(1.96)).toBeCloseTo(0.05, 2);
    expect(twoSidedZPValue(2.576)).toBeCloseTo(0.01, 2);
    // Unendliche/defekte Eingaben sind nicht „signifikant", sondern 1.
    expect(twoSidedZPValue(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("invertiert die Normalverteilung und deckt sich damit gegenseitig", () => {
    for (const p of [0.01, 0.025, 0.05, 0.5, 0.95, 0.975, 0.99]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
  });

  it("berechnet t-p-Werte und deckt sich mit der Normalverteilung bei großem df", () => {
    expect(twoSidedTPValue(0, 10)).toBeCloseTo(1, 10);
    // t(10), 5 % zweiseitig ≈ 2,228.
    expect(twoSidedTPValue(2.228, 10)).toBeCloseTo(0.05, 3);
    // Konvergenz: mit vielen Freiheitsgraden ≈ z.
    expect(twoSidedTPValue(1.96, 10_000)).toBeCloseTo(twoSidedZPValue(1.96), 3);
    expect(twoSidedTPValue(1, 0)).toBe(1);
  });
});

describe("Effektmaße und Stichprobengröße", () => {
  it("berechnet Cohen's h für Anteile und d für Mittelwerte", () => {
    expect(cohensH(0.5, 0.5)).toBeCloseTo(0, 12);
    // h = 2·asin(√0,8) − 2·asin(√0,5) = 2,2143 − 1,5708
    expect(cohensH(0.8, 0.5)).toBeCloseTo(0.6435011088, 8);
    // Symmetrie und Vorzeichen: h(0,25 gegen 0,75) ist der Negativwert.
    expect(cohensH(0.25, 0.75)).toBeCloseTo(-1.0471975512, 8);
    // Gepoolte Standardabweichung (Stichproben-SD): s_p = √(5/3) = 1,2910,
    // Mittelwerte 2,5 gegen 6,5 → d = −4 / 1,2910.
    expect(cohensD([1, 2, 3, 4], [5, 6, 7, 8])).toBeCloseTo(-3.0983866770, 8);
    // Gleiche Streuung, keine Streuung → Effekt 0, kein NaN.
    expect(cohensD([5, 5, 5], [5, 5, 5])).toBe(0);
  });

  it("berechnet die erforderliche Stichprobe (power 0,8, alpha 0,05)", () => {
    // Normalapproximation: n = 2·(z₀,₉₇₅ + z₀,₈)² / d².
    // Cohens Tabellen (t-basiert) nennen 64/26 — die Differenz von eins
    // entsteht durch die Näherung, nicht durch einen Fehler.
    expect(requiredSampleSize(0.5)).toBe(63);
    expect(requiredSampleSize(0.8)).toBe(25);
    // Größerer Effekt braucht weniger Messwerte — sonst ist die Formel falsch.
    expect(requiredSampleSize(0.2) as number).toBeGreaterThan(requiredSampleSize(0.5) as number);
    expect(requiredSampleSize(0)).toBeNull();
    expect(requiredSampleSize(Number.NaN)).toBeNull();
  });
});

describe("Anteilstest (binäre Messwerte)", () => {
  it("erkennt einen tragfähigen Unterschied", () => {
    const baseline = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const control = [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = assessProportionDifference({baseline, control});
    expect(result.computed).toBe(true);
    expect(result.method).toBe("TWO_PROPORTION_Z");
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significant).toBe(true);
    expect(result.confidenceInterval).not.toBeNull();
    // Die untere Grenze liegt über 0 (der Unterschied ist echt), die obere ist
    // auf den zulässigen Wertebereich einer Anteilsdifferenz gekürzt (≤ 1):
    // das ungekürzte Wald-Intervall ragte hier auf 1,006 hinaus.
    const [lower, upper] = result.confidenceInterval as [number, number];
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBeLessThanOrEqual(1);
    expect(upper).toBeGreaterThan(lower);
  });

  it("erkennt keinen Unterschied bei identischen Anteilen", () => {
    const values = [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0];
    const result = assessProportionDifference({baseline: values, control: values});
    expect(result.computed).toBe(true);
    expect(result.significant).toBe(false);
  });
});

describe("Mittelwertvergleich (Welch)", () => {
  it("erkennt einen großen, klar getrennten Unterschied", () => {
    const baseline = [98, 101, 99, 102, 97, 100, 103, 99, 98, 101];
    const control = [120, 124, 119, 122, 118, 125, 121, 123, 117, 126];
    const result = assessMeanDifference({baseline, control});
    expect(result.method).toBe("WELCH_T");
    expect(result.pValue).toBeLessThan(0.001);
    expect(result.significant).toBe(true);
    expect(result.effectSizeKind).toBe("COHENS_D");
    expect(Math.abs(result.effectSize as number)).toBeGreaterThan(2);
  });

  it("erkennt keinen Unterschied in zwei überlappenden Gruppen", () => {
    const baseline = [100, 101, 99, 102, 98, 100, 101, 99, 100, 101];
    const control = [100, 99, 102, 98, 101, 100, 99, 102, 100, 101];
    const result = assessMeanDifference({baseline, control});
    expect(result.significant).toBe(false);
  });
});

describe("Fail-closed-Verhalten ohne Daten", () => {
  it("behauptet nichts ohne Messwerte", () => {
    const empty = assessSignificance({baseline: [], control: []});
    expect(empty.computed).toBe(false);
    expect(empty.method).toBe("NONE");
    expect(empty.significant).toBeNull();
    expect(empty.confidence).toBe("UNKNOWN");
    expect(empty.reason).toMatch(/fehlen numerische Messwerte/i);

    const oneSided = assessSignificance({baseline: [1, 2, 3], control: []});
    expect(oneSided.significant).toBeNull();
    expect(oneSided.computed).toBe(false);
  });

  it("weist eine zu kleine Stichprobe als unzureichend aus", () => {
    const result = assessMeanDifference({baseline: [1, 100], control: [50, 200]});
    expect(result.computed).toBe(true);
    // Zwei Werte können rechnerisch „signifikant" wirken — ohne ausreichende
    // Stichprobe gilt das ausdrücklich nicht.
    expect(result.confidence).toBe("INSUFFICIENT");
    expect(result.requiredPerGroup).not.toBeNull();
    expect(result.requiredPerGroup as number).toBeGreaterThan(2);
  });

  it("lehnt eine zu kleine Gruppe für den Anteilstest ab", () => {
    const result = assessProportionDifference({baseline: [1], control: [0, 1]});
    expect(result.computed).toBe(false);
    expect(result.significant).toBeNull();
  });

  it("erkennt fehlende Streuung als nicht prüfbar", () => {
    const result = assessMeanDifference({baseline: [10, 10, 10], control: [10, 10, 10]});
    expect(result.computed).toBe(false);
    expect(result.significant).toBeNull();
    expect(result.reason).toMatch(/streuen nicht/i);
  });

  it("verweigert unterschiedliche Skalen", () => {
    const result = assessSignificance({baseline: [0, 1, 0, 1], control: [12.5, 13.2, 12.9]});
    expect(result.computed).toBe(false);
    expect(result.significant).toBeNull();
    expect(result.reason).toMatch(/unterschiedlich skaliert/i);
  });

  it("ignoriert nicht-endliche Werte statt sie zu übernehmen", () => {
    const result = assessMeanDifference({
      baseline: [1, 2, Number.NaN, 3, 4, 5, 6, 7, 8, 9],
      control: [10, 11, Number.POSITIVE_INFINITY, 12, 13, 14, 15, 16, 17, 18]
    });
    expect(result.samples.baseline).toBe(9);
    expect(result.samples.control).toBe(9);
    expect(result.computed).toBe(true);
  });

  it("wählt das Verfahren anhand der Skala", () => {
    const proportions = assessSignificance({baseline: [1, 1, 0, 1, 1, 1, 0, 1, 1, 1], control: [0, 0, 1, 0, 0, 1, 0, 0, 0, 0]});
    expect(proportions.method).toBe("TWO_PROPORTION_Z");
    const means = assessSignificance({baseline: [1.5, 2.5, 1.8, 2.2, 1.9, 2.1, 1.7, 2.3, 1.6, 2.4], control: [5.5, 6.5, 5.8, 6.2, 5.9, 6.1, 5.7, 6.3, 5.6, 6.4]});
    expect(means.method).toBe("WELCH_T");
  });
});
