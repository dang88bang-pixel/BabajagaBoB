/**
 * Reverse-Proxy-/Deployment-Header (Abschnitt 38, Betrieb hinter TLS-Terminierung).
 *
 * Die Plattform vergleicht für den CSRF-Schutz den `Origin`-Kopf mit dem
 * `Host`-Kopf und setzt das Session-Cookie nur dann mit `Secure`, wenn die
 * Anfrage über HTTPS kam. Hinter einem Reverse Proxy (Container, Kubernetes,
 * Preview-Umgebung, nginx/Caddy) sind beide Angaben nur dann korrekt, wenn die
 * weitergeleiteten Header ausgewertet werden — sonst wird **jede**
 * cookie-authentifizierte Mutation mit `403 CSRF_ORIGIN` abgelehnt, weil
 * `Origin` (öffentlicher Host) und `Host` (interner Host) auseinanderfallen.
 *
 * Fail closed bleibt der Standard: Ohne `BOB_TRUST_PROXY=1` werden die
 * weitergeleiteten Header **nicht** gelesen. Wer den Schalter setzt, erklärt
 * damit, dass ein Proxy davor sitzt, der diese Header setzt und überschreibt —
 * genau das ist die Voraussetzung für einen Betrieb hinter TLS-Terminierung.
 *
 * Mehrere Proxies hängen ihre Werte kommasepariert an (`X-Forwarded-Host:
 * public, internal`). Es zählt immer der **erste** Eintrag: der vom
 * äußersten Proxy gesehene, öffentliche Wert.
 */

/** Erster Wert einer kommaseparierten Header-Liste (oder `undefined`). */
function firstValue(header: string | null): string | undefined {
  const value = header?.split(",")[0]?.trim();
  return value ? value : undefined;
}

/**
 * Ob die weitergeleiteten Proxy-Header ausgewertet werden dürfen.
 * Standard: **nein** (fail closed).
 */
export function trustProxyEnabled(): boolean {
  return process.env.BOB_TRUST_PROXY === "1";
}

/** Öffentlicher Host der Anfrage (`X-Forwarded-Host` nur bei aktivem Vertrauen). */
export function effectiveHost(request: Request): string | undefined {
  if (trustProxyEnabled()) {
    const forwarded = firstValue(request.headers.get("x-forwarded-host"));
    if (forwarded) return forwarded.toLowerCase();
  }
  return request.headers.get("host")?.toLowerCase() || undefined;
}

/** Ob die Anfrage von außen über HTTPS kam (Proxy oder direkte TLS-Terminierung). */
export function isForwardedHttps(request: Request): boolean {
  if (trustProxyEnabled()) {
    const proto = firstValue(request.headers.get("x-forwarded-proto"));
    if (proto) return proto.toLowerCase() === "https";
  }
  return firstValue(request.headers.get("x-forwarded-proto")) === "https";
}
