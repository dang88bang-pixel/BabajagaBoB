"""Prüft die thematische Mindestabdeckung des Gold-Datensatzes."""

from __future__ import annotations

import json
from pathlib import Path

DATASET = Path(__file__).with_name('dataset.jsonl')
REQUIRED = {
    'sandbox': ['sandbox'],
    'authority': ['authority', 'berechtigung'],
    'causal_validation': ['established', 'kausal', 'evidenz'],
    'recovery': ['recovery', 'smoke'],
    'provenance': ['provenance'],
    'unknown_state': ['unknown'],
    'approval': ['approval'],
    'secrets': ['secret', 'vault'],
    'network_deny': ['netzwerk', 'deny'],
    'regression': ['regression'],
}

rows = [json.loads(line) for line in DATASET.read_text(encoding='utf-8').splitlines() if line.strip()]
if not rows:
    raise SystemExit('Dataset ist leer.')
text = DATASET.read_text(encoding='utf-8').lower()
missing = [name for name, patterns in REQUIRED.items() if not any(p in text for p in patterns)]
if missing:
    raise SystemExit('Fehlende Dataset-Abdeckung: ' + ', '.join(missing))
print(f'OK: {len(rows)} Samples; alle Kernabdeckungen vorhanden.')
