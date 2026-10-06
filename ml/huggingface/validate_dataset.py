"""Validiert den BabajagaBoB-SFT-Datensatz ohne externe Dienste."""

from __future__ import annotations

import json
from pathlib import Path

DATASET = Path(__file__).with_name('dataset.jsonl')
ALLOWED_ROLES = {'system', 'user', 'assistant', 'tool'}
REQUIRED_ROLES = {'user', 'assistant'}

def main() -> None:
    if not DATASET.exists():
        raise SystemExit(f'Dataset fehlt: {DATASET}')
    count = 0
    seen_users: set[str] = set()
    for line_no, raw in enumerate(DATASET.read_text(encoding='utf-8').splitlines(), 1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f'Zeile {line_no}: ungültiges JSON: {exc}') from exc
        messages = row.get('messages')
        if not isinstance(messages, list) or not messages:
            raise SystemExit(f'Zeile {line_no}: messages fehlt oder ist leer.')
        roles = {m.get('role') for m in messages if isinstance(m, dict)}
        if not REQUIRED_ROLES.issubset(roles):
            raise SystemExit(f'Zeile {line_no}: user/assistant fehlen.')
        for message in messages:
            if not isinstance(message, dict):
                raise SystemExit(f'Zeile {line_no}: Nachricht ist kein Objekt.')
            if message.get('role') not in ALLOWED_ROLES:
                raise SystemExit(f'Zeile {line_no}: unbekannte Rolle {message.get("role")!r}.')
            if not isinstance(message.get('content'), str) or not message['content'].strip():
                raise SystemExit(f'Zeile {line_no}: content fehlt.')
        user_text = '\n'.join(m['content'] for m in messages if m['role'] == 'user')
        if user_text in seen_users:
            raise SystemExit(f'Zeile {line_no}: doppelter User-Prompt.')
        seen_users.add(user_text)
        count += 1
    if count < 20:
        raise SystemExit(f'Zu wenig Goldsamples: {count}; mindestens 20 erwartet.')
    print(f'OK: {count} Conversational-SFT-Samples validiert.')

if __name__ == '__main__':
    main()
