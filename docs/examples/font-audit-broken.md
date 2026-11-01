# Font-Audit: Audit Broken Regular

**Urteil:** nicht-exportfähig · **Score:** 48/100 · **Datei:** 8 Glyphen, 1 KB, truetype, cmap-Format 4

| Kategorie | Punkte | Maximum |
| --- | --- | --- |
| struktur | 13 | 20 |
| geometrie | 11 | 30 |
| metrik | 1 | 25 |
| stil | 13 | 15 |
| features | 5 | 5 |
| stencil | 5 | 5 |

## Befunde

### 🛑 1 Glyphe mit überlappenden Konturen
`geometrie.ueberlappung` · geometrie

Konturen schneiden sich, statt vereinigt zu sein (z. B. Stamm + Querbalken). TrueType füllt das mit der Nonzero-Regel meist noch korrekt, aber Plotter, SVG-Exporte, Schablonen und Farb-Layer (COLR) erzeugen sichtbare Doppellinien bzw. Löcher. Abhilfe: Boolean-Union (Clipper/Martinez) vor dem Font-Build.

Betroffen: A

### 🛑 1 Glyphe mit selbstschneidenden Konturen
`geometrie.selbstschnitt` · geometrie

Eine Kontur kreuzt sich selbst. Ursache sind meist Miter-Spikes an spitzen Ecken oder eine zu große Stroke-Expansion. Abhilfe: Miter-Limit senken, Ecken abrunden (Bevel/Round) oder Kontur nach der Vereinigung neu schneiden.

Betroffen: C

### 🛑 1 Glyphe mit falscher Laufrichtung
`geometrie.laufrichtung` · geometrie

Außenkonturen müssen bei TrueType im Uhrzeigersinn laufen, Innenkonturen (Punzen) gegen den Uhrzeigersinn. Sonst verschwinden Löcher (O, A, B, 0) oder werden gefüllt – sichtbar in Photoshop, Plottern und in der Farb-Font-Ausgabe.

Betroffen: B

### 🛑 1 Glyphe überragt OS/2.usWinAscent
`metrik.clipping.oben` · metrik

Höchster Punkt im Font: 900 Units, usWinAscent: 800. Alles darüber wird in Word, DirectWrite und vielen Browsern abgeschnitten (typisch bei Kronen, Hörnern, Pfeil-Finials). usWinAscent auf den tatsächlichen Maximalwert setzen.

Betroffen: E

### 🛑 1 Glyphe ragt unter OS/2.usWinDescent
`metrik.clipping.unten` · metrik

Tiefster Punkt im Font: -420 Units, usWinDescent: 200. Daggers, Drips und Unterlängen werden sonst horizontal abgeschnitten.

Betroffen: D

### 🛑 1 Glyphe mit Vorschub 0
`metrik.vorschub.null` · metrik

Glyphen mit Tinte, aber advanceWidth 0, stapeln sich übereinander. Mindestens Striche + Seitenlage als Vorschub setzen.

Betroffen: F

### 🛑 6 Buchstabenpaare kollidieren
`metrik.abstand.kollision` · metrik

Die Bounding-Boxen überlappen ohne Kerning. Optische Kerning-Engine (Silhouetten-Scan) oder breitere Seitenlagen verwenden. Die schlimmsten Paare stehen in `spacing.collisions`.

Betroffen: FA FB FC FD FE FF

### 🛑 20 Großbuchstaben fehlen
`struktur.coverage.buchstaben` · struktur

Für Tags, Poster und Karten sollten A–Z vollständig sein.

Betroffen: G H I J K L M N O P Q R S T U V W X Y Z

### ⚠️ 1 Glyphe ohne On-Curve-Extrema
`geometrie.extrema.fehlt` · geometrie

Extremwerte von Bögen liegen mitten im Segment statt auf einem Knoten. Kleine Grade fransen dadurch aus, Hinting greift nicht, und automatische Schriftglättungen (z. B. beim Konvertieren) verschieben die Formen.

Betroffen: F

### ⚠️ 1 Glyphe mit degenerierten Konturen
`geometrie.degeneriert` · geometrie

Konturen mit weniger als drei Punkten oder Fläche null. Sie tragen nichts zur Form bei, erzeugen aber Fehler in manchen Rasterizern.

Betroffen: C

### ⚠️ 1 Glyphe mit negativer Seitenlage
`metrik.seitenlage.negativ` · metrik

Die Tinte ragt links vor den Ursprung oder rechts über den Vorschub hinaus. Ohne Kerning kollidieren diese Zeichen mit dem Nachbarn.

Betroffen: F

### ⚠️ Keine Kerning-Daten
`metrik.kerning.fehlt` · metrik

Weder `kern` noch `GPOS` vorhanden. Paare wie AV, LT, WA sitzen dann zwangsläufig zu weit auseinander. Für Satz und Kartenmotive Kerning-Paare exportieren (kern format 0 oder GPOS Pair Positioning).

### ⚠️ 10 Ziffern fehlen
`struktur.coverage.ziffern` · struktur

Ziffern werden für Jahreszahlen, Crew-Nummern und Preise gebraucht.

Betroffen: 0 1 2 3 4 5 6 7 8 9

### ⚠️ Strichstärke im Alphabet inkonsistent
`stil.strichbreite.streuung` · stil

Median 208 Units, Variationskoeffizient 52 % (Ziel < 22 %). Ursache ist meist eine Strich-Expansion, die pro Skelett-Segment statt pro Glyphe normalisiert. Abweichende Glyphen sind unten gelistet.

Betroffen: gid0 A B C D E

### ℹ️ Keine OpenType-Layout-Tabellen
`features.keine-opentype` · features

Ohne GSUB/GPOS gibt es keine Ligaturen, keine kontextuellen Alternativen und kein Kerning über GPOS. Für Graffiti-Verbindungen (`ST`, `CH`, `TH`) und Wortmarken ist GSUB mit `liga`/`calt` der Hebel.

## Metriken

| Wert | Zahl |
| --- | --- |
| unitsPerEm | 1000 |
| hhea ascender/descender | 800 / -200 |
| OS/2 Typo | 800 / -200 |
| OS/2 win | 800 / 200 |
| tatsächlich oben/unten | 900 / -420 |
| Median-Strich | 208 Units (CV 52 %) |
| Kontrast (dick/dünn) | 3.81× |
| Paarabstand min/max | -600 / 200 Units |
| Kerning-Paare | 0 |
| Buchstaben | 6/26 (fehlt: GHIJKLMNOPQRSTUVWXYZ) |
| Ziffern | 0/10 (fehlt: 0123456789) |

## Kollidierende Paare

| Paar | Abstand |
| --- | --- |
| FA | -600 |
| FB | -600 |
| FD | -600 |
| FE | -600 |
| FF | -600 |
| FC | -500 |
