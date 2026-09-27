/**
 * Statistische Signifikanzprüfung (Abschnitt 15 — Kausalvalidierung).
 *
 * Die Science Layer verlangt bisher Baseline, Kontrolle, Replikation und
 * Evidenz, bevor eine Behauptung als `ESTABLISHED` gilt. Was fehlte, war die
 * Frage, ob ein beobachteter Unterschied **überhaupt tragfähig** ist: Drei
 * zufällig günstige Läufe sind kein Beleg.
 *
 * Dieses Modul ergänzt genau diese Prüfung — und bleibt dabei bewusst streng:
 *
 *  - **Keine Behauptung ohne Daten.** Fehlen Messwerte, ist das Ergebnis
 *    `significant: null` (UNKNOWN) mit benanntem Grund. `null` ist nie „ja“.
 *  - **Fail closed bei zu kleiner Stichprobe.** Weniger als zwei Werte je
 *    Gruppe ergeben keine Aussage; zusätzlich wird die *erforderliche* Gruppe
 *    für das beobachtete Effektmaß berechnet und als `requiredPerGroup`
 *    ausgewiesen. Liegt die Stichprobe darunter, bleibt die Aussage
 *    `INSUFFICIENT` — auch dann, wenn der p-Wert klein aussieht (kleine
 *    Stichproben produzieren zu leicht signifikante Zufallstreffer).
 *  - **Nur lokale Mathematik.** Kein Netzwerk, kein Provider, keine externe
 *    Bibliothek: Normalverteilung (Fehlerfunktion), t-Verteilung über die
 *    unvollständige Beta-Funktion, Effektmaße nach Cohen.
 *  - **Effektmaß neben dem p-Wert.** Ein signifikanter, aber praktisch
 *    bedeutungsloser Unterschied wird als solcher ausgewiesen
 *    (`effectSize`, `effectSizeKind`), nicht weggewertet.
 *
 * Die Zahlen sind Näherungen mit dokumentierter Genauigkeit (siehe die
 * Hinweise an den Funktionen) — ausreichend für eine Ja/Nein-Entscheidung im
 * Rahmen der Kausalvalidierung, ausdrücklich **kein** Ersatz für eine
 * fachstatistische Auswertung.
 */

export type SignificanceMethod = "NONE" | "TWO_PROPORTION_Z" | "WELCH_T";

export type SignificanceConfidence = "SUFFICIENT" | "INSUFFICIENT" | "UNKNOWN";

export type SignificanceAssessment = {
  /** Wurde tatsächlich gerechnet? `false` heißt: keine Aussage, nie „signifikant“. */
  computed: boolean;
  method: SignificanceMethod;
  /** Warum (nicht) gerechnet wurde — immer gesetzt, auch im Erfolgsfall. */
  reason: string;
  alpha: number;
  samples: {baseline: number; control: number};
  /** Mindeststichprobe je Gruppe für das beobachtete Effektmaß (power 0,8). */
  requiredPerGroup: number | null;
  statistic: number | null;
  pValue: number | null;
  /** Konfidenzintervall der Differenz (zweiseitig, 1−alpha). */
  confidenceInterval: [number, number] | null;
  effectSize: number | null;
  effectSizeKind: "COHENS_H" | "COHENS_D" | null;
  /** `null` = nicht entscheidbar (UNKNOWN), nie „true“ ohne Berechnung. */
  significant: boolean | null;
  confidence: SignificanceConfidence;
};

const DEFAULT_ALPHA = 0.05;
const DEFAULT_POWER = 0.8;
/** Unter dieser Gruppengröße ist keine Varianzschätzung möglich. */
const MIN_PER_GROUP = 2;

/* ------------------------------------------------------------ Verteilungen */

/**
 * Fehlerfunktion (Abramowitz & Stegun 7.1.26).
 * Genauigkeit ≈ 1,5e-7 — für p-Werte in dieser Größenordnung unerheblich.
 *
 * Die Näherung ist nur für `|x| > 0` definiert und liefert dort einen
 * Restfehler von etwa 1e-9; an der Nullstelle wird deshalb exakt 0 zurückgegeben.
 * Ohne diesen Sonderfall wäre `normalCdf(0)` ≈ 0,5000000005 statt genau 0,5 und
 * `twoSidedZPValue(0)` ≈ 0,999999999 — ein messbarer Fehler an der Stelle, die
 * am häufigsten vorkommt (kein Unterschied zwischen den Gruppen).
 */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * value);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-value * value);
  return sign * y;
}

/** Verteilungsfunktion der Standardnormalverteilung. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Zweiseitiger p-Wert eines z-Wertes. */
export function twoSidedZPValue(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
}

/** Inverses der Standardnormalverteilung (Acklam-Näherung, |Fehler| < 1,15e-9). */
export function normalQuantile(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function logGamma(x: number): number {
  // Lanczos-Koeffizienten (g=5). Die letzten beiden sind auf 15 signifikante
  // Stellen gerundet: mehr Stellen passen nicht in ein IEEE-754-Double, und die
  // Genauigkeit dieser Näherung liegt ohnehin bei ~1e-7 (siehe incompleteBeta).
  const coefficients = [76.1800917294715, -86.5053203294168, 24.0140982408309, -1.23173957245016, 0.00120865097386618, -0.00000539523938495];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.00000000019002;
  for (const coefficient of coefficients) series += coefficient / ++y;
  // √(2π) = 2,5066282746310002…
  return -tmp + Math.log((2.5066282746310002 * series) / x);
}

/** Regulierte unvollständige Beta-Funktion (Kettenbruch, Numerical Recipes). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITERATIONS = 300;
  const EPSILON = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Zweiseitiger p-Wert eines t-Wertes mit `df` Freiheitsgraden. */
export function twoSidedTPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, incompleteBeta(df / 2, 0.5, x)));
}

/** Quantil der t-Verteilung (für Konfidenzintervalle). */
export function tQuantile(p: number, df: number): number {
  if (!Number.isFinite(df) || df <= 0 || !Number.isFinite(p)) return Number.NaN;
  if (p <= 0 || p >= 1) return Number.NaN;
  // Einfache, robuste Intervallschachtelung: die Verteilungsfunktion ist
  // stetig und monoton, 100 Schritte genügen für die hier nötige Genauigkeit.
  let low = -100;
  let high = 100;
  const target = p;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const cumulative = 1 - 0.5 * twoSidedTPValue(middle, df);
    if (cumulative < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/* ------------------------------------------------------------ Deskriptoren */

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

const isProportionSample = (values: number[]): boolean => values.every(value => value === 0 || value === 1);

/* --------------------------------------------------------------- Effektmaß */

/** Cohen's h für zwei Anteile (kleiner Effekt ab 0,2; groß ab 0,8). */
export function cohensH(p1: number, p2: number): number {
  const transform = (p: number) => 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, p))));
  return transform(p1) - transform(p2);
}

/** Cohen's d mit gepoolter Standardabweichung. */
export function cohensD(a: number[], b: number[]): number {
  const va = variance(a);
  const vb = variance(b);
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return Number.NaN;
  const pooled = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
  if (pooled === 0) return 0;
  return (mean(a) - mean(b)) / pooled;
}

/** Erforderliche Stichprobe je Gruppe (zweiseitig, power 0,8). */
export function requiredSampleSize(effectSize: number, alpha = DEFAULT_ALPHA, power = DEFAULT_POWER): number | null {
  if (!Number.isFinite(effectSize) || effectSize === 0) return null;
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  if (!Number.isFinite(zAlpha) || !Number.isFinite(zBeta)) return null;
  return Math.ceil((2 * (zAlpha + zBeta) ** 2) / effectSize ** 2);
}

/* ------------------------------------------------------------- Bewertungen */

function notComputed(reason: string, samples: {baseline: number; control: number}, alpha: number): SignificanceAssessment {
  return {
    computed: false,
    method: "NONE",
    reason,
    alpha,
    samples,
    requiredPerGroup: null,
    statistic: null,
    pValue: null,
    confidenceInterval: null,
    effectSize: null,
    effectSizeKind: null,
    significant: null,
    confidence: "UNKNOWN"
  };
}

/**
 * Zwei Anteile (Erfolg/Misserfolg je Gruppe) — z-Test mit gepooltem
 * Standardfehler. Geeignet für „Läufe bestanden / nicht bestanden".
 */
export function assessProportionDifference(input: {
  baseline: number[];
  control: number[];
  alpha?: number;
}): SignificanceAssessment {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const baseline = input.baseline.filter(value => value === 0 || value === 1);
  const control = input.control.filter(value => value === 0 || value === 1);
  const samples = {baseline: baseline.length, control: control.length};
  if (baseline.length < MIN_PER_GROUP || control.length < MIN_PER_GROUP) {
    return notComputed(
      `Signifikanz nicht prüfbar: je Gruppe sind mindestens ${MIN_PER_GROUP} binäre Messwerte nötig (vorhanden: ${baseline.length}/${control.length}).`,
      samples,
      alpha
    );
  }
  const p1 = mean(baseline);
  const p2 = mean(control);
  const successes = (values: number[]): number => values.reduce((sum: number, value) => sum + value, 0);
  const pooled = (successes(baseline) + successes(control)) / (baseline.length + control.length);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / baseline.length + 1 / control.length));
  const difference = p1 - p2;
  const effectSize = cohensH(p1, p2);
  const required = requiredSampleSize(effectSize, alpha);
  if (standardError === 0) {
    return {
      ...notComputed("Signifikanz nicht prüfbar: kein Unterschied in den Anteilen (Standardfehler 0).", samples, alpha),
      effectSize,
      effectSizeKind: "COHENS_H",
      requiredPerGroup: required
    };
  }
  const z = difference / standardError;
  const pValue = twoSidedZPValue(z);
  const quantile = normalQuantile(1 - alpha / 2);
  const margin = quantile * Math.sqrt((p1 * (1 - p1)) / baseline.length + (p2 * (1 - p2)) / control.length);
  // Das Wald-Intervall kann bei extremen Anteilen über [−1, 1] hinausragen —
  // eine Differenz zweier Anteile kann das aber nicht. Gekürzt wird auf den
  // zulässigen Wertebereich, damit das Intervall keine unmögliche Aussage
  // transportiert („Anteil von 100,6 %").
  const clamp = (value: number): number => Math.min(1, Math.max(-1, value));
  const sufficient = required === null ? samples.baseline >= MIN_PER_GROUP && samples.control >= MIN_PER_GROUP : samples.baseline >= required && samples.control >= required;
  return {
    computed: true,
    method: "TWO_PROPORTION_Z",
    reason: `z-Test über zwei Anteile (p̄=${pooled.toFixed(3)}), ${samples.baseline} gegen ${samples.control} Messwerte.`,
    alpha,
    samples,
    requiredPerGroup: required,
    statistic: z,
    pValue,
    confidenceInterval: [clamp(difference - margin), clamp(difference + margin)],
    effectSize,
    effectSizeKind: "COHENS_H",
    significant: pValue < alpha,
    confidence: sufficient ? "SUFFICIENT" : "INSUFFICIENT"
  };
}

/**
 * Zwei Mittelwerte mit ungleichen Varianzen (Welch). Geeignet für Laufzeiten,
 * Speicher, Trefferquoten — also alle echten Zahlenmessungen.
 */
export function assessMeanDifference(input: {baseline: number[]; control: number[]; alpha?: number}): SignificanceAssessment {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const baseline = input.baseline.filter(value => Number.isFinite(value));
  const control = input.control.filter(value => Number.isFinite(value));
  const samples = {baseline: baseline.length, control: control.length};
  if (baseline.length < MIN_PER_GROUP || control.length < MIN_PER_GROUP) {
    return notComputed(
      `Signifikanz nicht prüfbar: je Gruppe sind mindestens ${MIN_PER_GROUP} Messwerte nötig (vorhanden: ${baseline.length}/${control.length}).`,
      samples,
      alpha
    );
  }
  const va = variance(baseline);
  const vb = variance(control);
  const difference = mean(baseline) - mean(control);
  const effectSize = cohensD(baseline, control);
  const required = requiredSampleSize(effectSize, alpha);
  if (!Number.isFinite(va) || !Number.isFinite(vb)) {
    return notComputed("Signifikanz nicht prüfbar: Varianz nicht bestimmbar.", samples, alpha);
  }
  const standardError = Math.sqrt(va / baseline.length + vb / control.length);
  if (standardError === 0) {
    return {
      ...notComputed("Signifikanz nicht prüfbar: beide Gruppen streuen nicht (Standardfehler 0).", samples, alpha),
      effectSize,
      effectSizeKind: "COHENS_D",
      requiredPerGroup: required
    };
  }
  const t = difference / standardError;
  const df =
    (va / baseline.length + vb / control.length) ** 2 /
    ((va / baseline.length) ** 2 / (baseline.length - 1) + (vb / control.length) ** 2 / (control.length - 1));
  const pValue = twoSidedTPValue(t, df);
  const quantile = tQuantile(1 - alpha / 2, df);
  const margin = Number.isFinite(quantile) ? quantile * standardError : Number.NaN;
  const sufficient =
    required === null ? samples.baseline >= MIN_PER_GROUP && samples.control >= MIN_PER_GROUP : samples.baseline >= required && samples.control >= required;
  return {
    computed: true,
    method: "WELCH_T",
    reason: `Welch-t-Test (df=${df.toFixed(2)}), ${samples.baseline} gegen ${samples.control} Messwerte.`,
    alpha,
    samples,
    requiredPerGroup: required,
    statistic: t,
    pValue,
    confidenceInterval: Number.isFinite(margin) ? [difference - margin, difference + margin] : null,
    effectSize,
    effectSizeKind: "COHENS_D",
    significant: pValue < alpha,
    confidence: sufficient ? "SUFFICIENT" : "INSUFFICIENT"
  };
}

/**
 * Wählt das Verfahren anhand der Daten: reine 0/1-Werte → Anteilstest,
 * sonst Mittelwertvergleich. Ungeeignete oder fehlende Daten bleiben
 * ausdrücklich ohne Aussage.
 */
export function assessSignificance(input: {baseline: number[]; control: number[]; alpha?: number}): SignificanceAssessment {
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const baseline = Array.isArray(input.baseline) ? input.baseline.filter(value => Number.isFinite(value)) : [];
  const control = Array.isArray(input.control) ? input.control.filter(value => Number.isFinite(value)) : [];
  const samples = {baseline: baseline.length, control: control.length};
  if (baseline.length === 0 || control.length === 0) {
    return notComputed(
      "Signifikanz nicht prüfbar: es fehlen numerische Messwerte für Baseline oder Kontrolle.",
      samples,
      alpha
    );
  }
  if (isProportionSample(baseline) && isProportionSample(control)) return assessProportionDifference({baseline, control, alpha});
  if (isProportionSample(baseline) !== isProportionSample(control)) {
    return notComputed(
      "Signifikanz nicht prüfbar: Baseline und Kontrolle sind unterschiedlich skaliert (binär gegen metrisch).",
      samples,
      alpha
    );
  }
  return assessMeanDifference({baseline, control, alpha});
}
