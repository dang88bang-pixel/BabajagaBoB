/**
 * Next.js-Instrumentierung: Start der kontrollierten Egress-Schicht.
 *
 * Der Egress-Proxy ist eine Operator-Entscheidung und läuft nur, wenn beim
 * Start `BOB_EGRESS_PROXY=1` gesetzt ist. Ohne ihn bleibt die Netzwerk-Vorgabe
 * DENY und ALLOWLIST ist weiterhin fail closed (MASTER §10). Der Proxy läuft
 * im selben Prozesskontext wie die Control Plane, damit Allowlist-Store,
 * DNS-Pins und Audit-Pfad dieselben Instanzen sind.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.BOB_EGRESS_PROXY !== "1") return;
  const {ensureEgressProxy} = await import("./lib/egress");
  const port = Number(process.env.BOB_EGRESS_PROXY_PORT ?? 0);
  await ensureEgressProxy({port: Number.isInteger(port) && port > 0 ? port : 0});
}
