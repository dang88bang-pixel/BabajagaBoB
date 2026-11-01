# Alternativen-Evaluation — 2026-11-01

**Zweck:** Für jeden in `docs/TODO.md` offenen Punkt (plus die zwei im
Deeptest gefundenen Betriebsbeobachtungen) sind die realistischen Optionen
ermittelt, **in dieser Umgebung gemessen** und gegen die Regeln des Repositorys
bewertet (kein Mock als reale Implementierung, kein Status ohne Nachweis,
Sicherheitsgrenze vor Funktionsgewinn).

**Methode:** Jede Option wurde nicht nur gelesen, sondern angreifbar geprüft
(Download, Start, Lauf, Fehlerfall). Was nicht messbar war, steht als
`NICHT MESSBAR` mit Grund — nicht als Annahme.

**Verwandte Dokumente:** `docs/DEEP_VERIFICATION_2026-11-01.md` (Ist-Zustand),
`docs/TODO.md` (offene Punkte), `docs/ACCEPTANCE.md` (Abnahmematrix).

---

## 0. Messumgebung (Grundlage aller Aussagen)

| Größe | Wert |
|---|---|
| Kernel / Distribution | Linux, Debian 12 Basis, glibc 2.36 |
| Rechte | UID 1001, **passwortloses `sudo` vorhanden** (getestet: `sudo -n id` → `uid=0`) |
| Namespaces | `unshare -Ur` funktioniert; Rootfs 126 MB aus `scripts/build-ns-rootfs.sh` |
| PID 1 | `systemd` (aber **keine User-Session**: `systemctl --user` → „Failed to connect to bus") |
| cgroup v2 | Controller `cpuset cpu io memory pids`; Delegation unter `/sys/fs/cgroup` mit `sudo` möglich |
| Docker/Podman/runc/crun | **nicht vorhanden** |
| Browser / X-Server / OCR | **nicht vorhanden** (`chromium`, `Xvfb`, `tesseract` fehlen) |
| Erlaubte Fremd-Hosts | `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` |
| Nicht erreichbar (gemessen) | `deb.debian.org` (apt: „Connection failed"), `release-assets.githubusercontent.com` (GitHub-Release-Downloads: 302, 0 Byte) |

---

## 1. Computer-Use-Treiber (größter Hebel: `CU-001` von `PARTIAL` → `VERIFIED`)

Gesucht: ein **echter** Browser-/Desktop-Treiber, der im Sandbox-Workspace läuft und
über den vorhandenen Treibervertrag (`BOB_COMPUTER_DRIVER`, Node-Modul, `argv[]`,
`shell:false`) erreichbar ist.

| Option | Messergebnis in dieser Umgebung | Bewertung |
|---|---|---|
| **A: `@sparticuz/chromium` + `puppeteer-core` (npm)** | **funktioniert**: Chromium 153 startet in ~0,5 s; `page.goto` auf lokalen `http.server` ✅, `page.type` ✅, `page.click` ✅, DOM-Text ✅, **echter PNG-Screenshot** (7 580 Bytes, Magic `PNG`) ✅. Needs: `LD_LIBRARY_PATH` auf die mitgelieferten NSS-Bibliotheken aus `al2023.tar.br` (entpackt, 3,4 MB) | **empfohlen** |
| B: `playwright` + `npx playwright install chromium` | Download-Host des Browsers nicht in der Allowlist — nicht prüfbar, in dieser Umgebung **nicht möglich** | zurückgestellt |
| C: System-Chromium via `apt` | `sudo apt-get update` → alle Indizes „Connection failed"; `apt-get download libnss3` → „Unable to locate package" | **BLOCKED** |
| D: `chrome-remote-interface` an vorhandenen Browser | kein Browser vorhanden | **BLOCKED** |
| E: jsdom als „Browser" | rendert nicht, kein Pixel, kein Klick — wäre ein **Mock als reale Implementierung** | **verboten** (Spec §3) |
| F: Zustand belassen (fail closed ohne Treiber) | heute so umgesetzt und getestet | Rückfalloption, bleibt jederzeit gültig |

**Kosten von A (gemessen):** 105 MB `node_modules` (Chromium 67 MB komprimiert → 200 MB
entpackt, `puppeteer-core` 8,3 MB); Kaltstart 494 ms inkl. Navigation, Tippen,
Klick, Screenshot.

**Risiken von A, die *wir* schließen müssen (nicht die Umgebung):**
1. **Netz** — der Browser darf nichts nach außen. Gemessen: `https://example.com` scheitert
   hier nur, weil der Sandbox-Egress gesperrt ist (`ERR_CONNECTION_CLOSED`). Das ist
   **keine** Policy des Projekts. Der Treiber muss selbst sperren:
   `--host-resolver-rules="MAP * ~NOTFOUND"`, kein Proxy, dazu Request-Interception
   (nur `data:`, `file:`, `blob:` und `127.0.0.1`), und die Sperre muss als Evidenz
   im Artefakt stehen.
2. **Supply Chain** — `@sparticuz/chromium` liefert ein 200-MB-Binärpaket ohne
   Signatur. Nötig: feste Version, `integrity`-Prüfung, eigener SHA-256 im Evidenzdatensatz.
3. **Isolation** — Chromium bringt einen eigenen Sandbox-Mechanismus mit; im
   Namespace-Rootfs fehlt `/dev/shm`. Der Lauf muss im **ns-exec**-Pfad mit
   `--no-sandbox` (weil der Namespace schon die Grenze bildet) und
   `--disable-dev-shm-usage` erfolgen — und das muss dokumentiert und getestet sein.

**Empfehlung:** Option A, hinter dem bestehenden Treibervertrag, mit den drei
Maßnahmen oben. Aufwand ≈ 1 Tag (Treiber + Netz-Sperre + 6–8 Tests + Live-Nachweis
+ Doku). Ergebnis: `CU-001` kann `VERIFIED` werden, nicht nur `PARTIAL`.

---

## 2. OCR-Aktion (`OCR` ist heute nur eine deklarierte Aktionsklasse)

| Option | Messergebnis | Bewertung |
|---|---|---|
| **A: `tesseract.js@7` + `@tesseract.js-data/{deu,eng}@1` (npm)** | Pakete auf `registry.npmjs.org` vorhanden (7.0.0 / 1.0.0); Sprachdaten sind **npm-Pakete**, also ohne CDN vendelbar | **empfohlen**, wenn OCR gebraucht wird |
| B: System-`tesseract` via apt | apt nicht erreichbar | **BLOCKED** |
| C: „OCR" durch DOM-/Accessibility-Text ersetzen | liefert Text, ist aber **keine** OCR — Umbenennung der Aktion wäre eine stille Semantikänderung | abgelehnt, solange die Spec `OCR` verlangt |
| D: `OCR` bleibt `NOT_IMPLEMENTED` | heute so | zulässig, aber im Matrix-Status benannt |

**Empfehlung:** A erst, wenn eine Anforderung OCR wirklich braucht (Spec nennt OCR als
Aktionsklasse). Kosten: ~30 MB WASM + ~15 MB Sprachdaten je Sprache; Aufwand ≈ 0,5 Tag.

---

## 3. Desktop- und CLI-Instanzen (`DESKTOP`, `CLI`)

| Option | Messergebnis | Bewertung |
|---|---|---|
| Desktop über `Xvfb` + `xdotool` + `import` | `import` (ImageMagick) ist da, **`Xvfb` fehlt**, apt blockiert | **BLOCKED** (heute) |
| Desktop über Chromium-Headless-Screenshot | nur Browser, kein Desktop — Umdeutung wäre falsch | abgelehnt |
| **CLI über die bestehende Namespace-Runtime** | funktioniert bereits (`REAL_LOCAL` + `NAMESPACES`, `argv[]`) | **empfohlen**: `kind: "CLI"` mit `PROCESS_READ`/`FILE_READ`/`TERMINAL_EXECUTE` ehrlich über den Runtime-Pfad ausführen, nicht über einen zweiten Mechanismus |
| `DESKTOP` bleibt `NOT_IMPLEMENTED` | heute so | zulässig, Status bleibt benannt |

**Empfehlung:** CLI jetzt (Aufwand ≈ 0,5 Tag, nutzt vorhandene Runtime), `DESKTOP`
bewusst offen lassen und im Matrix-Status als `NOT_IMPLEMENTED` führen.

---

## 4. OCI-Runtime (`OCI-001`, heute `UNVERIFIED`)

| Option | Messergebnis | Bewertung |
|---|---|---|
| A: `runc`-Binärdatei von GitHub-Releases | Download liefert **302 auf `release-assets.githubusercontent.com`, 0 Byte** | **BLOCKED** |
| B: `crun`/`podman`/`docker` statisch | gleiche Hosting-Domain, keine npm-Pakete mit Binärdatei (`runc`/`crun` auf npm sind JS-Wrapper: „interface to runc" bzw. „Generates JavaScript functions") | **BLOCKED** |
| C: aus Quellcode bauen | `go`/`rustc` fehlen, apt und Release-Downloads gesperrt | **BLOCKED** |
| D: OCI-*Bundle* selbst erzeugen (`config.json` + Rootfs) und mit dem eigenen Namespace-Runner starten | technisch möglich, aber ohne echten OCI-Runtime-Prozess ist es **kein** `CONTAINER` — Bezeichnung müsste `NAMESPACES` bleiben | zulässig als Zwischenschritt, ändert den Status **nicht** |
| E: Status bleibt `UNVERIFIED`, Isolation bleibt gemessen `NAMESPACES` | heute so, inkl. 11 Tests | **empfohlen** |

**Empfehlung:** E. Kein Aufwand, keine Scheinsicherheit. Der einzige echte Pfad zu
`CONTAINER` ist ein Host mit Daemon oder erlaubter Release-Domain — beides ist eine
**Betreiberentscheidung**, keine Codeänderung. D bleibt optional als Übung für
Bundle-Kompatibilität, darf aber nie als Container-Isolation deklariert werden.

---

## 5. Speicher-/Prozesslimits ohne delegierbare cgroups (neu aufgetan)

Beim Nachmessen mit `sudo` zeigte sich etwas Neues und Wichtiges:

- Mit `sudo` lässt sich `/sys/fs/cgroup/bob` anlegen, Controller sind verfügbar
  (`+.memory +pids`), und **root kann Prozesse dort hineinschreiben** (`root_write_ok`).
- Ein **unprivilegierter** Prozess kann es **nicht**: `cgroup.procs` gehört zwar dem
  Benutzer, das Schreiben endet aber mit `EACCES`. Der laufende
  `ns-exec.sh` bricht dann **fail closed** ab (`exit 126`, „cgroup-Beitritt
  fehlgeschlagen — nichts wurde ausgeführt"). Der Isolationsbericht meldet in dieser
  Lage trotzdem `CGROUP_MEMORY_LIMIT`/`CGROUP_PIDS_LIMIT` in `enforced[]`, obwohl
  **jeder Lauf scheitert** — ein irreführender Bericht, kein Sicherheitsleck.
- Keine systemd-User-Session → `systemd-run --user` fällt als Weg aus.

| Option | Messergebnis | Bewertung |
|---|---|---|
| A: Root-Helper (`sudoers`-Regel für ein schmales Skript, das cgroup anlegt, `chown -R`, Prozess beitritt) | root-Weg funktioniert nachgewiesen | **empfohlen**, wenn Limits Pflicht werden: eng, prüfbar, auditierbar |
| B: ganze Plattform als root | funktioniert, aber weitere Blast-Radius | abgelehnt |
| **C: `RLIMIT_AS` (`ulimit -v`) statt cgroup** | gemessen: node startet mit **1 GiB** VA-Limit, stirbt bei **512 MiB** schon beim Start; ein 900-MB-Puffer unter 512 MiB scheitert | **empfohlen als Fallback**: kernel-seitig, ohne Privilegien — aber es ist ein **VA**-Cap, nicht RSS, und braucht eine Untergrenze (~1 GiB) für Node |
| D: Status quo (unavailable + fail closed) | heute so, immerhin laut | akzeptabel, aber der **Bericht muss korrigiert werden** (siehe unten) |

**Befund — bereits behoben (2026-11-01, in diesem Branch):** Wenn `BOB_CGROUP_DIR`
gesetzt war und der Beitritt scheiterte, führte `enforced[]` die cgroup-Limits
trotzdem. Ursache: `cgroupAvailable()` prüfte nur **Dateirechte**. Behoben durch:

1. `statfs`-Prüfung auf cgroup-v2-Magic (ein gewöhnliches Verzeichnis mit Dateien
   namens `cgroup.procs` setzt nichts durch und gilt nicht mehr als Unterbaum),
2. einen **echten Beitrittstest** (kurzer Kindprozess schreibt sich in ein
   Probe-cgroup) — genau der Schritt, der beim Benutzer mit `EACCES` scheitert,
3. den Bericht: `UNAVAILABLE` mit dem Kernel-Grund statt `ENFORCED`.

Belegt live gegen `GET /api/runtime` mit delegiertem, aber unprivilegiertem
Unterbaum:

```
"isolation": "NAMESPACES",
"cgroup": "UNAVAILABLE",
"detail": "… cgroup-Beitritt nicht möglich (Error: EACCES: permission denied, write);
           Delegation ohne Privilegien — Speicher- und Prozesslimits sind nicht
           durchsetzbar …"
"cgroupInEnforced": []          # vorher: ["CGROUP_MEMORY_LIMIT","CGROUP_PIDS_LIMIT"]
```

Regressionstest: `tests/integration/ns-cgroup-report.test.ts` (3 Tests). Zusätzlich
überspringt sich der cgroup-Nachweis in `ns-isolation.test.ts` jetzt **sichtbar mit
Grund**, statt still zurückzukehren — vorher „bestand" er bei fehlgeschlagenem
Beitritt, weil ein fail-closed-Abbruch als Zählerstand `0` durchging.

---

## 6. Betriebsbeobachtungen aus dem Deeptest

| Punkt | Optionen | Empfehlung |
|---|---|---|
| Ohne `BOB_SESSION_SECRET` (≥ 32 Zeichen) startet der Dienst, jede Anfrage endet mit 500 | A: Start verweigern (fail fast), B: wie heute (fail closed, spät), C: Secret automatisch erzeugen und persistieren (0600) | **A**, plus Hinweis im Startlog; C nur, wenn `BOB_CREATOR_SECRET_FILE`-Muster gewünscht ist. Aufwand ≈ 20 Minuten |
| Prüfskripte brauchen mehr als das Standard-Ratelimit (120/min) | A: Skripte laufen mit erhöhtem Budget (heute), B: eigenes Bucket für Verifikation, C: Limit im Testbetrieb abschaltbar (abgelehnt: Grenze wäre weg) | **A** beibehalten, Grenze separat mit `scripts/verify-rate-limit.sh` gegen frische Instanz nachweisen — so ist beides belegt |
| `/api/devices {action:"enroll"|"heartbeat"}` → 503 ohne `BOB_DEVICE_ENROLLMENT_SECRET` | A: so lassen (fail closed), B: Secret automatisch erzeugen | **A**; 503 ist korrekt, der Aktionsprüfer muss die Variable setzen (dokumentiert) |

---

## 7. Entscheidungsübersicht

| # | Gap | Empfohlene Option | Aufwand | Wirkung | Risiko |
|---|---|---|---|---|---|
| 1 | Computer-Use-Treiber | **A: `@sparticuz/chromium` + `puppeteer-core`** hinter `BOB_COMPUTER_DRIVER` | ~1 Tag | `CU-001` → `VERIFIED` möglich | Supply Chain, Netz-Sperre muss eigener Code sein |
| 2 | CLI-Instanzen | Namespace-Runtime statt neuem Mechanismus | ~0,5 Tag | `CLI` real ausführbar | gering |
| 3 | OCR | `tesseract.js` + vendored Sprachdaten — nur wenn gefordert | ~0,5 Tag | `OCR` real | WASM-Größe, Datenherkunft |
| 4 | DESKTOP | offen lassen (`BLOCKED`: kein X-Server) | 0 | Status bleibt ehrlich | — |
| 5 | OCI (`OCI-001`) | offen lassen (`UNVERIFIED`), Betreiberentscheidung | 0 | keine Scheinsicherheit | — |
| 6 | cgroup-Limits | **C: `RLIMIT_AS`-Fallback** + A (Root-Helper) optional | 0,5–1 Tag | Speicherlimit kernel-seitig ohne Privilegien | VA ≠ RSS, Node-Untergrenze |
| 7 | cgroup-Bericht | **erledigt in diesem Branch** (statfs + echter Beitrittstest + Regressionstest + Live-Beleg) | ~1 h | Bericht sagt die Wahrheit | gering |
| 8 | Session-Secret | Startprüfung (fail fast) | ~0,5 h | kein 500-Lauf ohne Secret | gering |

**Reihenfolge:** ~~7~~ (erledigt) → 8 → 1 → 2 → 6 → 3. (7/8 sind Minuten und schließen
Irreführungen; 1 bringt den größten Reifegradsprung; 6 verbessert die Grenze ohne
neue Abhängigkeit.)

---

## 8. Was diese Evaluation ausdrücklich **nicht** tut

- Sie erklärt keine Option zum Erfolg, die hier nicht lief (Playwright, apt,
  System-Chromium, runc-Binärdatei, Xvfb).
- Sie schlägt keinen Mock vor, wo die Spec eine reale Fähigkeit verlangt.
- Sie ändert keinen Status in `docs/ACCEPTANCE.md`; neue Reifegrade gibt es erst mit
  Implementierung **und** Test **und** Nachweis.
