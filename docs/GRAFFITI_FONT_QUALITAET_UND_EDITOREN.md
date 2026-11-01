# Graffiti-Font: Qualitätsprüfung des Alphabets & passende Produktions-Werkzeuge

**Stand:** 2026-11-01 · **Prüfobjekt:** Pipeline „Graffiti-Bildvorlage → Glyphen → TTF/OTF“
**Neu in diesem Repo:** ausführbarer Glyph-Auditor (`lib/font/`, `scripts/audit-font.ts`) mit 19 Tests gegen echte fontTools-Binaries.

---

## 0. Kurzfassung

| Frage | Antwort |
| --- | --- |
| Ist die beschriebene Pipeline im Ansatz tragfähig? | Ja – aber **erst nach** Boolean-Union, echter Metrik-Engine und ehrlichem Font-Build. Vorher erzeugt sie formal gültige, optisch und technisch fehlerhafte Dateien. |
| Kann man die Qualität messen statt „ansehen“? | Ja. Der Auditor prüft die **Binärdatei** (nicht die Vorschau): Überlappungen, Laufrichtung, Extrema, Clipping, Strichstärke-Konsistenz, Weißraum, Kerning, Zeichenabdeckung, Farb-/Variable-Tabellen. |
| Was ist der schwerwiegendste Einzelfehler im bisherigen Code? | Der stille Fallback `synthesizeMinimalTtf()` – er liefert nur einen 12-Byte-Header und gibt die Datei trotzdem als „Font“ aus. Ein Nutzer lädt damit eine defekte Datei herunter, ohne Warnung. |
| Welche Editoren sind für die Weiterarbeit sinnvoll? | Glyphr Studio 2 (Browser, OTF/TTF/WOFF-Export), FontForge (Reparatur/Simplify), BirdFont (Farbfonts), Inkscape (Vektormontage/Schablonen), Photopea (Effekte, Schrift lazy laden), Scribus (Print), Blender (3D/Merch). Details in §5. |
| Was fehlt für „professionelle Kunst/Wallpaint/Grußkarten“? | Nicht die Vektorisierung, sondern **Metrik, Kerning-Export, Clipping-Sicherheit** und ein **Schablonen-Modus**. Genau diese vier Punkte sind unten als Messgrößen definiert. |

---

## 1. Was in diesem Checkout tatsächlich prüfbar war

Die in der Projektbeschreibung skizzierte Engine (`geometryEngine.ts`, `skeletonLibrary.ts`, `pipeline.worker.ts`, `opentypeAdapter.ts` …) liegt **nicht** in diesem Repository – dort steht die Agent-Control-Plane (`app/`, `lib/`, `tests/`). Eine Aussage wie „die Glyphen sind gut“ wäre ohne Datei reine Behauptung. Deshalb wurde die Prüfung dort angesetzt, wo sie belastbar ist: an der exportierten Schriftdatei.

**Neu implementiert:**

| Datei | Zweck |
| --- | --- |
| `lib/font/sfnt.ts` | SFNT-Reader ohne Abhängigkeiten: `head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap` (Format 4/12), `loca`, `glyf` (einfach + Composite), `name`, `kern`, `GPOS`/`GSUB`, `COLR`/`CPAL`, `fvar` |
| `lib/font/geometry.ts` | Konturaufbau mit impliziten Off-Curve-Punkten, Flächenvorzeichen, Punkt-in-Polygon, Segment-Schnitt, Selbstschnitt-, Überlappungs- und Extrema-Analyse |
| `lib/font/raster.ts` | Scanline-Rasterizer (Nonzero) + Chamfer-Distanztransformation → **gemessene** Strichbreite, Streuung, Tintenfläche |
| `lib/font/audit.ts` | Regelwerk mit 20 Befund-IDs, Score je Kategorie, Urteil, Markdown-Report |
| `scripts/audit-font.ts` | CLI mit Exit-Codes für CI (`--json`, `--md`, `--pixels`, `--min-score`) |
| `tests/fixtures/fonts/*.ttf` | zwei mit **fontTools** gebaute Echt-Binaries (sauber / absichtlich fehlerhaft) |
| `scripts/make-font-audit-fixtures.py` | reproduzierbare Fixture-Erzeugung |

```bash
npm run audit:font -- pfad/zu/GraffitiVibe.ttf
npm run audit:font -- GraffitiVibe.ttf --json report.json --md report.md
```

Beispielausgaben: `docs/examples/font-audit-good.md` (Score 98/100, 0 Fehler) und
`docs/examples/font-audit-broken.md` (Score 48/100, 8 Fehler – genau die Fehlerklassen der beschriebenen Pipeline).

---

## 2. Qualitätsmaßstäbe: was „gut“ messbar bedeutet

Die folgenden Werte sind keine Geschmacksfragen, sondern Schwellen, ab denen ein Font in Browsern, Plottern, Office und Schablonenwerkzeugen sichtbar versagt.

| Kriterium | Messung | Zielwert | Warum bei Graffiti kritisch | Finding-ID |
| --- | --- | --- | --- | --- |
| Konturvereinigung | Schnitte zwischen Konturen einer Glyphe | 0 | Stamm + Querbalken getrennt exportiert → Doppellinien, Löcher in Farb-Layern, unschneidbare Schablonen | `geometrie.ueberlappung` |
| Selbstschnitte | Schnitte innerhalb einer Kontur | 0 | Miter-Spikes und Sharp-Caps erzeugen Achter-Konturen; Rasterizer füllen sie falsch | `geometrie.selbstschnitt` |
| Laufrichtung | Vorzeichen der Fläche je Verschachtelungstiefe | außen CW, innen CCW | Falsch gewickelt verschwinden Punzen (O, A, B, 0) | `geometrie.laufrichtung` |
| Extrema | Extremwert mitten im Quadratik-Segment | 0 | Kleine Grade (Web, Karten) fransen aus, Hinting greift nicht | `geometrie.extrema.fehlt` |
| Vertikales Clipping | `max(yMax)` vs. `OS/2.usWinAscent`, `min(yMin)` vs. `usWinDescent` | 0 Überschreitungen | Daggers, Drips, Kronen werden in Word/Browsern abgeschnitten – der häufigste „mein Font sieht falsch aus“-Fehler | `metrik.clipping.oben/unten` |
| Strichstärke-Konsistenz | Median-Strich pro Glyphe, Variationskoeffizient | CV < 22 % | Stilbruch innerhalb des Alphabets; genau das Gegenteil von „Stilkonstanz“ | `stil.strichbreite.streuung` |
| Weißraum | Paarabstand `advance(L) + xMin(R) − xMax(L)` | 0 Kollisionen, CV < 35 % | Graffiti hat unregelmäßige Silhouetten; Bounding-Box-Vorschub reicht nicht | `metrik.abstand.kollision/.streuung` |
| Kerning | `kern`-Paare oder `GPOS` Pair Positioning | vorhanden | AV, LT, WA sitzen sonst zwangsläufig falsch | `metrik.kerning.fehlt` |
| Abdeckung | A–Z, 0–9, Leerzeichen, Interpunktion | vollständig | Jahreszahlen, Crew-Namen, Kartenclaim | `struktur.coverage.*` |
| Schablonentauglichkeit | Innenkonturen + Median-Strich | Steg ≥ 20–40 Units | Inseln (A, O, 0, 8) fallen beim Schneiden heraus | `stencil.inseln`, `stencil.duenne-stege` |
| Variable Font | `fvar` **und** `gvar` | beides | Achsen ohne gvar sind wirkungslos (siehe §3.7) | `features.variabel.ohne-gvar` |
| Farbfont | `COLR` **und** `CPAL` | beides | COLR ohne Palette wird ignoriert/schwarz gezeichnet | `features.farbe.ohne-palette` |

**Messgenauigkeit:** Auf dem Referenz-Fixture (Rahmen mit exakt 100 Units Strichbreite) misst die Distanztransformations-Methode 104 Units bei 128 px/em – Fehler < 5 %, ausreichend für Stil-Audits, nicht für Hinting.

---

## 3. Befunde am bisherigen Pipeline-Entwurf (Code-Review)

Alle Punkte sind mit dem Auditor nachweisbar, sobald eine Datei exportiert wurde.

### 3.1 Pro Strich ein eigener Pfad, keine Vereinigung
`GeometryEngine.buildGlyphOutlines()` erzeugt für **jedes** Skeleton-Stroke einen eigenen `VectorPath` und hängt sie an. Beim `A` (zwei Beine + Querbalken), `E` (Stamm + drei Arme), `T`, `H`, `K` entstehen Überlappungen. Korrekt wäre **eine** unions-vereinigte Konturmenge (Clipper/Martinez) **vor** dem Font-Build.

### 3.2 `evenodd` + gleichgerichtete Konturen
`expandPolyline()` schreibt Außen- und Innenkante als zwei geschlossene Konturen mit derselben Laufrichtung und `fillRule: 'evenodd'`. TrueType kennt kein `evenodd`; die `glyf`-Tabelle füllt mit **Nonzero**. Ergebnis: je nach Renderer gefüllte Punzen oder invertierte Flächen. Der Auditor meldet das als `geometrie.laufrichtung`.

### 3.3 Kappen und Ecken sind Approximationen
- Round-Terminal: ein einziges `Q`-Segment über den Mittelpunkt – das ist eine Parabel, kein Halbkreis; bei dicken Strichen sichtbar abgeflacht.
- Sharp-Terminal: Verlängerung um `strokeWidth * 0.6` **entlang der Tangente**, ohne Breitenverjüngung – ergibt Nadeln statt Dolche und erzeugt bei Kurven Selbstschnitte.
- `cornerSharpness` steuert nur den Miter-Clamp (0,5–3,0), nicht die Join-Geometrie (Miter/Bevel/Round).

### 3.4 Statische vertikale Metriken
`pipeline.worker.ts` schreibt für jede Glyphe `ascender: 800, descender: -200`, und der Font-Build setzt dieselben Werte in `hhea`/`OS/2`. Drips (`injectDrips`) und Daggers (`applyBaselineDaggers`) ragen darüber hinaus → **Abschneiden**. Der Auditor berechnet die echten Extremwerte und meldet die Differenz (`metrik.clipping.*`).

### 3.5 Vorschub aus Formel statt aus Metrik
`advanceWidth = defaultAdvance * widthRatio + strokeWidth`, Seitenlagen fix `0.4 * strokeWidth`. Das ignoriert, dass Graffiti-Buchstaben extrem unterschiedliche Silhouetten haben. Ergebnis: Kollisionen und „Löcher“ im Satz. Die vorhandene `MetricsEngine.generateKerningTable()` wird berechnet, aber **nie in die Datei geschrieben** – Kerning fehlt in der Ausgabe (`metrik.kerning.fehlt`).

### 3.6 Der stille Defekt-Fallback
`OpentypeAdapter.synthesizeMinimalTtf()` erzeugt 2048 + n·1024 Bytes, schreibt einen Header und `return buffer`. Fehlt `window.opentype` (z. B. CDN offline, PWA-Cache leer), wird diese Datei als „TTF“ heruntergeladen. Sie enthält keine Tabellen. Das ist kein Fallback, sondern eine Fehlerquelle, die man erst beim Installieren merkt. **Empfehlung:** entweder echtes TTF schreiben (wie in §7 beschrieben) oder hart abbrechen.

### 3.7 Variable Font ohne Variationsdaten
`VariableFontEngine` erzeugt Master-Paare und interpoliert Punkte – aber es entsteht keine `fvar`/`gvar`-Struktur. Ein daraus gebauter Font hat keine Achsen; wird `fvar` ohne `gvar` geschrieben, bleiben die Regler wirkungslos (`features.variabel.ohne-gvar`).

### 3.8 Stil-Extraktion ist zur Hälfte fest verdrahtet
`StyleExtractor` misst tatsächlich nur `strokeWidth` (Horizontalläufe) und `slantAngle` (Kovarianz). `curvatureBias = 0.25`, `widthRatio = 1.05`, `cornerSharpness = 0.85`, `terminalStyle = 'sharp'`, `contrastAxis = π/4`, `contrastIntensity = 0.35` sind **Konstanten**. „Stil aus der Bildvorlage“ ist damit derzeit ein Etikett, keine Übertragung. Der Auditor liefert die Gegenprobe: `stil.strichbreite.streuung`, `style.contrastRatio`, `style.inkAreaCv`.

### 3.9 Sheet-Segmentierung ist ein festes Raster
`SheetGridSegmenter.segmentSheet(imageData, rows, cols)` schneidet ein starres Gitter und vergibt Unicode **sequenziell**. Bei Blackbook-Pieces ohne Gitter (Interlocking, überlappende Buchstaben), bei 5×6-Sheets oder bei fehlenden Buchstaben ist die Zuordnung falsch. Nötig: Connected-Component-Analyse mit Sortierung nach Zeile/Spalte, Otsu-Schwelle, Größenfilter, sowie manuelle Korrektur-UI für die Unicode-Zuordnung.

### 3.10 Graffiti-Effekte ohne Vereinigung
`injectDrips()` und `generate3DShadow()` hängen zusätzliche Pfade an dieselbe Glyphe; `generateChiseledBevelLayers()` erzeugt pro Kante ein Viereck → bei 200 Konturpunkten 199 überlappende Flächen. Ohne Union ist das für COLR-Layer, Plotter und SVG-Export unbrauchbar – im Auditor als `geometrie.ueberlappung` sichtbar.

**Priorität der Behebung:** 3.1 + 3.2 (sonst ist alles andere Kosmetik) → 3.6 → 3.4 + 3.5 (Kerning-Export) → 3.9 → 3.8 → 3.7 → 3.3/3.10.

---

## 4. Messprotokoll: Alphabet in fünf Minuten prüfen

1. **Exportieren** (TTF, nicht „OTF“ mit TrueType-Outlines – Namensverwirrung vermeiden).
2. **Auditieren:**
   ```bash
   npm run audit:font -- GraffitiVibe.ttf --md report.md --json report.json
   ```
   Exit-Code 1 = mindestens ein Fehler. In CI: `--min-score 85`.
3. **Reparieren in dieser Reihenfolge:** Überlappungen/Selbstschnitte → Laufrichtung → Extrema → `OS/2`-Metriken → Vorschub/Kerning → Stilabweichungen.
4. **Gegenprüfen in echten Anwendungen** (der Auditor ersetzt keine Rasterprüfung):
   - Browser: Datei per `@font-face` laden, bei 12/16/24/72 px ansehen (Extrema-/Hinting-Fehler zeigen sich klein).
   - **Wakamai Fondue** – zeigt Tabellen, Features, Achsen, Paletten: <https://wakamaifondue.com>
   - **FontDrop!** – schnelle Tabellen-/Glyph-Übersicht: <https://fontdrop.info>
   - **Fontspector** (Nachfolger von FontBakery) für die OpenType-/Google-Fonts-Konformität: <https://github.com/fonttools/fontbakery> · Referenz: Type-Design-Ressourcen nennen Fontspector als aktuelles Werkzeug [1](https://tofutype.ca/type-design-resources/)
   - OTS-Prüfung passiert automatisch: Chrome/Firefox/Edge verweigern Fonts, die OTS nicht akzeptiert.
5. **Schablonen-Check:** Glyphen mit `counterCount > 0` auflisten (`report.glyphs`), Stege einplanen (§6 D).

---

## 5. Werkzeugmatrix (recherchiert, Stand November 2026)

### 5.1 Typografie-Feinschliff & Reparatur

| Werkzeug | Plattform | Lizenz/Kosten | Stärke für dieses Projekt | Grenze |
| --- | --- | --- | --- | --- |
| **Glyphr Studio 2** | Browser, 100 % clientseitig | Open Source, kostenlos | Importiert TTF/OTF/WOFF, Bézier-Editor, Komponenten, Ligaturen, Kerning-Gruppen; **Export als OTF, TTF, WOFF, WOFF2** (ab v2.10) – direkt aus dem Browser, keine Installation [2](https://www.glyphrstudio.com/help/about/updates.html) | Kein `gvar`-Aufbau; Kerning-Export ist auf 16.146 Paare begrenzt [3](https://www.glyphrstudio.com/help/pages/kerning.html) |
| **FontForge** | Win/macOS/Linux | BSD, kostenlos | Der Reparatur-Werkzeugkasten: `Element → Simplify → Remove Overlap`, Extrema setzen, `Validate`, Batch-Skripte (Python) | Oberfläche alt, keine Farbfont-Bearbeitung auf modernem Niveau |
| **FontTools / fontmake / pyftsubset** | CLI, Python | MIT, kostenlos | Das Referenz-Toolchain: echte `fvar`/`gvar`-Erzeugung aus Designspace, Subsetting, WOFF2, Tabellen-Patches | Lernkurve, Python-Umgebung |
| **BirdFont** | Win/macOS/Linux | GPLv3-Version kostenlos; Binärversion für kommerzielle Fonts lizenzpflichtig | **Farbfonts (COLR/CPAL, SVG-in-OTF)**, SVG-Import, Autotrace [4](https://birdfont.org/) | Import ganzer TTF/OTF zum Bearbeiten eingeschränkt |

### 5.2 Illustration, Komposition, Effekte

| Werkzeug | Plattform | Lizenz | Wofür |
| --- | --- | --- | --- |
| **Inkscape** | Desktop | GPL, kostenlos | Vektormontage, boolesche Pfadoperationen, Offset-Pfad, Schablonen-Stege, SVG/DXF-Export für Plotter |
| **Photopea** | Browser | kostenlos, werbefinanziert | Photoshop-Ebenenstile (Bevel & Emboss, Verlauf, Schlagschatten, Glow) auf Text; eigene Schrift per **Datei → Öffnen** oder „Load Font“/Drag & Drop laden, „Local Fonts“ für Systemschriften [5](https://techdepot.blog/can-you-upload-fonts-to-photopea) |
| **Krita** | Desktop | GPL | Spray-, Splatter- und Airbrush-Pinsel für Chrome-/Drip-Optik hinter den Vektoren |
| **Blender** | Desktop | GPL | Textobjekt aus `.ttf`, Extrusion/Bevel → isometrische 3D-Blöcke, STL für 3D-Druck, Cycles-Renderings für Mockups |

### 5.3 Wand, Mural, Tagging im Außenraum

| Werkzeug | Plattform | Kosten | Einsatz |
| --- | --- | --- | --- |
| **Beamer + SVG/PDF** | jeder Projektor | Hardware vorhanden | Nachts/indoor 1:1 projizieren, Konturen mit Kreide nachziehen; SVG aus Inkscape in Originalgröße skalieren |
| **Mural Maker (Da Vinci Eye)** | iOS | kostenlos + In-App-Käufe | AR-Projektion, „AR Tracking“ merkt sich die Position über Sessions, Breakdown-Modus zerlegt Farben in Schablonen [6](https://allsharktankproducts.com/shark-tank-products-arts/da-vinci-eye-ar-drawing-tools/) |
| **Da Vinci Eye: AR Trace & Draw** | iOS/Android/Vision Pro | kostenlos + Abo (~8 $/Monat, ~30 $/Jahr), eigenes Foto nur in Pro [7](https://gridmakerpro.com/compare/best-tracing-app-for-drawing/) | Stabilisierte Projektion, Value-Layer |
| **Doodle Grid / Grid Maker Pro** | iOS/Android | kostenlos bzw. Freemium | Unregelmäßiges Raster statt Messgitter: Referenzpunkte auf die Wand sprühen, Foto machen, digital überlagern |

### 5.4 Schablone, Plotter, Laser

| Werkzeug | Plattform | Kosten | Einsatz |
| --- | --- | --- | --- |
| **Inkscape + Schneideplotter** (Cricut Design Space, Silhouette Studio) | Desktop/Web | Inkscape frei, Plotter-Software frei | Stege einfügen (`Pfad → Differenz`), Mylar/Folie schneiden; Mindeststeg 1–2 mm |
| **LightBurn / LaserGRBL** | Desktop | LightBurn kostenpflichtig (Testversion), LaserGRBL frei | SVG/DXF importieren, Schnitt-/Gravurparameter für Sperrholz/Schaumplatten |
| **Stencil-fähige Glyph-Variante** | – | – | Aus dem Auditor die Insel-Glyphen exportieren und als zweite Ebene (Insel separat) plotten, wenn kein Steg gewünscht ist |

### 5.5 Print, Grußkarten, Merch

| Werkzeug | Plattform | Kosten | Einsatz |
| --- | --- | --- | --- |
| **Scribus** | Desktop | GPL | DTP mit CMYK, Beschnitt, PDF/X-Export für Druckereien; Schriften einbetten |
| **GIMP** | Desktop | GPL | Bitmap-Karten, Texturen (Betony, Papier) unter der Schrift |
| **Inkscape + Photopea** | Desktop/Browser | frei | Karten-Layout vektoriell, Finish (Prägung, Glanz) als Bitmap |
| **Blender** | Desktop | GPL | 3D-Tags, Keychains, STL-Dateien für Druckdienstleister |

**Lizenzhinweis (wichtig für „professionell/frei erweiterbar“):** generierte Fonts unter **SIL Open Font License 1.1** veröffentlichen, wenn sie weiterverwendet werden sollen; BirdFont-Binaries dürfen nur unter OFL(-ähnlichen) Bedingungen kostenlos genutzt werden; Inkscape/GIMP/Blender/Scribus/Photopea-Ausgaben sind frei. Bei Graffiti-Vorlagen: Referenzbilder Dritter (z. B. „MikiStyle“, „Dingeling“) sind **Stilvorbilder, keine Kopiervorlagen** – Silhouetten nicht 1:1 vektorisieren.

---

## 6. Fünf Produktionsketten (Rezepte)

### A) Tagging/Lettering digital (Poster, Cover, Social)
```
GraffitiVibe.ttf → audit:font → Photopea (Load Font)
   → Textebene 300 dpi → Ebenenstile: Bevel&Emboss, Verlauf, Schlagschatten
   → Export PNG/PSD → optional Inkscape für Vektor-Nachzeichnung der Highlights
```
Prüfen: `stil.strichbreite.streuung` (kein Ausreißer), `metrik.abstand.kollision` = 0.

### B) Grußkarte / Print
```
Scribus: Format 148×105 mm + 3 mm Beschnitt
   → Textrahmen mit GraffitiVibe, Kerning prüfen (report.spacing.collisions)
   → Farben in CMYK anlegen (kein RGB-Schwarz für Text!)
   → PDF/X-4 mit Schrifteinbettung exportieren → Druckerei
```
Vorher: `metrik.clipping.*` = 0, sonst schneidet die Karte Drips ab.

### C) Wallpaint / Mural
```
Inkscape: Schriftzug 1:1 in Metern anlegen (SVG-Einheit mm)
   → Beamer-Projektion oder Mural Maker (AR) → Konturen mit Kreide
   → Füllungen layern (Block → Fill → Keyline → Highlights)
```
Für Drips/Daggers: `report.font.minGlyphY` prüfen – beim Projektieren ist „unten“ die Wandkante, nicht die Baseline.

### D) Schablone / Laser / Plotter
```
1. report.glyphs filtern: counterCount > 0  → Insel-Glyphen
2. Inkscape: Steg-Rechtecke einfügen, Pfad → Differenz (Steg = max(20 Units, 1,5 mm))
3. Export SVG (Pfad, mm) oder DXF → LightBurn/Cricut
4. Teststück in Karton, Steg mit 2–3 mm prüfen
```
Der Auditor liefert die Mindest-Strichbreite (`style.medianStrokeWidth`) für die Steg-Dimensionierung.

### E) Merch / 3D
```
Blender: Textobjekt → Font laden → Extrude 0,06 + Bevel 0,004
   → Material Beton/Chrom → Cycles-Render oder STL-Export (3D-Druck)
```

---

## 7. Was als Nächstes in die Engine gehört (Reihenfolge)

1. **Boolean-Union als Pflichtschritt.** `clipper2-wasm` oder `martinez-polygon-clipping` im Worker, Ergebnis mit korrekter Laufrichtung (außen CW, innen CCW), ein Pfad pro Fläche. Danach alle Effekt-Layer erneut vereinigen.
2. **Echter TTF-Writer statt Header-Stub.** Tabellen: `head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap` (4 + 12), `loca`, `glyf`, `name`, `post`, optional `kern`/`GPOS`, `COLR`/`CPAL`, `fvar`/`gvar`. Rundung auf Integer, `xMin/yMin/xMax/yMax` aus echten Konturen, `usWinAscender/Descender` **berechnet**.
3. **Metrik-Engine mit Overshoot-Ausgleich.** Runde Formen (O, C, S) 1–2 % über Kapitalhöhe/Baseline, flache Formen exakt; Seitenlagen aus Strichbreite und Silhouettensteigung, nicht aus Konstante.
4. **Kerning wirklich exportieren.** Berechnete Paare in `kern` (Format 0) oder `GPOS` Pair Positioning schreiben; Ziel: 0 Kollisionen, Abstands-CV < 35 %.
5. **Sheet-Segmentierung über Connected Components** (Otsu → CC → Zeilen-Clustering → Unicode-Zuordnung mit UI-Korrektur), statt festem Raster.
6. **Stil-Extraktion vervollständigen**: Kontrastachse über Hough/Struktur-Tensor, Terminalform über Endpunkt-Krümmung klassifizieren, `curvatureBias` aus dem Verhältnis Bogenlänge/Sehnenlänge je Stroke.
7. **Variable Font echt bauen**: Master-TTFs + `.designspace` + `fontTools.varLib.build` (Pyodide im Browser oder Offline-Build). Achsen: `wght`, `wdth`, `slnt`, Custom `XCRV`/`XCRN`.
8. **Farbfont-Strategie festlegen**: COLRv0 (sichere Basis, alle modernen Browser) plus optional COLRv1 nur mit Fallback – **Safari rendert COLRv1 bis heute nicht** [8](https://blog.fontlab.com/2026/05/03/color-fonts-in-2026/).
9. **KI-Module zuletzt.** Diffusion/ONNX für Missing-Glyph-Synthesis ist nur sinnvoll, wenn die deterministische Geometrie steht – sonst erzeugt das Modell Formen, die die Metrik-Engine anschließend nicht reparieren kann.

---

## 8. Anhang

### 8.1 Befund-IDs (vollständig)

| ID | Schwere | Bedeutung |
| --- | --- | --- |
| `audit.scope.cff-nicht-dekodiert` | Warnung | PostScript-Outlines werden nicht geometrisch geprüft |
| `struktur.tabelle.*` | Fehler/Warnung | Pflicht-Tabelle fehlt (`head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap`, `name`, `post`) |
| `struktur.em.ungewoehnlich` | Warnung | `unitsPerEm` ≠ 1000/2048 |
| `struktur.name.family-fehlt` | Fehler | `name`-ID 1 leer |
| `struktur.coverage.buchstaben/.ziffern/.leerzeichen` | Fehler/Warnung | Zeichen fehlen |
| `geometrie.ueberlappung` | Fehler | Konturen nicht vereinigt |
| `geometrie.selbstschnitt` | Fehler | Kontur kreuzt sich selbst |
| `geometrie.laufrichtung` | Fehler | Wickelrichtung falsch (Punzen) |
| `geometrie.extrema.fehlt` | Warnung | Extremwert ohne On-Curve-Knoten |
| `geometrie.degeneriert` | Warnung | Kontur < 3 Punkte / Fläche 0 |
| `metrik.clipping.oben/.unten` | Fehler | Glyphe über `usWinAscent`/unter `usWinDescent` |
| `metrik.typo.vorzeichen` | Fehler | Typo-Metriken mit falschem Vorzeichen |
| `metrik.vorschub.null` | Fehler | `advanceWidth` 0 bei vorhandener Tinte |
| `metrik.seitenlage.negativ` | Warnung | Tinte vor Ursprung / über Vorschub |
| `metrik.abstand.kollision` | Fehler | Bounding-Box-Überlappung ohne Kerning |
| `metrik.abstand.streuung` | Warnung | Ungleichmäßiger Weißraum |
| `metrik.kerning.fehlt` | Warnung | kein `kern`/`GPOS` |
| `stil.strichbreite.streuung` | Warnung | Stilbruch im Alphabet |
| `stencil.duenne-stege` | Warnung | zu dünn für Schnittschablonen |
| `stencil.inseln` | Hinweis | Innenkonturen benötigen Stege |
| `features.keine-opentype` | Hinweis | keine GSUB/GPOS |
| `features.farbe` / `features.farbe.ohne-palette` | Hinweis/Fehler | COLR/CPAL-Status |
| `features.variabel` / `features.variabel.ohne-gvar` | Hinweis/Fehler | Achsen ohne Variationsdaten |

### 8.2 Score-Gewichte

| Kategorie | Gewicht | Abzug |
| --- | --- | --- |
| struktur | 20 | −5 je Fehler (max. 5), −2 je Warnung (max. 6) |
| geometrie | 30 | dito |
| metrik | 25 | dito |
| stil | 15 | dito |
| features | 5 | dito |
| stencil | 5 | dito |

Urteil: „produktionsreif“ ab 90 Punkten **ohne** Fehler, „nutzbar-mit-nacharbeiten“ ab 60, sonst „nicht-exportfähig“.

### 8.3 Verifikation

```bash
npx vitest run tests/unit/font-audit.test.ts   # 19 Tests
npm run typecheck                              # tsc --noEmit
npm run lint
npm run fixtures:fonts                         # Fixtures neu bauen (braucht fontTools)
```

Die Tests prüfen nicht nur Happy-Path, sondern dass jede Fehlerklasse der fehlerhaften Fixture erkannt **und dem richtigen Zeichen** zugeordnet wird (A → Überlappung, B → Laufrichtung, C → Selbstschnitt, D → Clipping unten, E → Clipping oben, F → Extrema/Vorschub/Kollision).

### 8.4 Quellen

1. Type Design Resources – Werkzeugliste (Fontspector als Nachfolger von FontBakery): <https://tofutype.ca/type-design-resources/>
2. Glyphr Studio Update-Log v2.10 (Export TTF/WOFF/WOFF2, Font Flux JS): <https://www.glyphrstudio.com/help/about/updates.html>
3. Glyphr Studio Kerning-Dokumentation (16.146 Paare, GPOS-Import): <https://www.glyphrstudio.com/help/pages/kerning.html>
4. BirdFont (COLR/CPAL, SVG-in-OTF, Export TTF/OTF/EOT/SVG): <https://birdfont.org/>
5. Photopea – eigene Fonts laden: <https://techdepot.blog/can-you-upload-fonts-to-photopea>
6. Mural Maker (Da Vinci Eye) – AR-Tracking, Breakdown, Multiplayer: <https://allsharktankproducts.com/shark-tank-products-arts/da-vinci-eye-ar-drawing-tools/>
7. Vergleich Projektions-/Tracing-Apps 2026: <https://gridmakerpro.com/compare/best-tracing-app-for-drawing/>
8. Color Fonts 2026 – COLRv0/v1 und Browser-Support: <https://blog.fontlab.com/2026/05/03/color-fonts-in-2026/>
