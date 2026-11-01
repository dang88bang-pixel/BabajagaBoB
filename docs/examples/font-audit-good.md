# Font-Audit: Audit Good Regular

**Urteil:** produktionsreif · **Score:** 98/100 · **Datei:** 38 Glyphen, 3 KB, truetype, cmap-Format 4

| Kategorie | Punkte | Maximum |
| --- | --- | --- |
| struktur | 20 | 20 |
| geometrie | 30 | 30 |
| metrik | 23 | 25 |
| stil | 15 | 15 |
| features | 5 | 5 |
| stencil | 5 | 5 |

## Befunde

### ⚠️ Keine Kerning-Daten
`metrik.kerning.fehlt` · metrik

Weder `kern` noch `GPOS` vorhanden. Paare wie AV, LT, WA sitzen dann zwangsläufig zu weit auseinander. Für Satz und Kartenmotive Kerning-Paare exportieren (kern format 0 oder GPOS Pair Positioning).

### ℹ️ 36 Glyphen mit geschlossenen Inseln
`stencil.inseln` · stencil

Bei geschnittenen Schablonen fallen die Innenräume heraus (A, B, D, O, P, Q, R, 0, 4, 6, 8, 9). Vor dem Plotter-Export Stege von mindestens 20–40 Units (1–2 mm) einplanen oder die Glyphen in zwei Ebenen (Insel separat) ausgeben.

Betroffen: A B C D E F G H I J K L … (24 weitere)

### ℹ️ Keine OpenType-Layout-Tabellen
`features.keine-opentype` · features

Ohne GSUB/GPOS gibt es keine Ligaturen, keine kontextuellen Alternativen und kein Kerning über GPOS. Für Graffiti-Verbindungen (`ST`, `CH`, `TH`) und Wortmarken ist GSUB mit `liga`/`calt` der Hebel.

## Metriken

| Wert | Zahl |
| --- | --- |
| unitsPerEm | 1000 |
| hhea ascender/descender | 800 / -200 |
| OS/2 Typo | 800 / -200 |
| OS/2 win | 800 / 220 |
| tatsächlich oben/unten | 700 / 0 |
| Median-Strich | 104 Units (CV 0 %) |
| Kontrast (dick/dünn) | 1× |
| Paarabstand min/max | 200 / 200 Units |
| Kerning-Paare | 0 |
| Buchstaben | 26/26 |
| Ziffern | 10/10 |
