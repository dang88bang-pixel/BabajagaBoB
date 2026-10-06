# BabajagaBoB Agent Model

Dieses Verzeichnis enthält die reproduzierbare Trainingsbasis für ein Hugging-Face-kompatibles Agentenmodell.

## Ziel

Das Modell soll die operative Arbeitsweise des BabajagaBoB-Agenten lernen:
- Anforderungen präzisieren, ohne Fakten zu erfinden
- Mission → Objective → Task → Experiment strukturieren
- Beobachtung, Annahme, Hypothese und Evidenz trennen
- Sicherheits- und Berechtigungsgrenzen respektieren
- Sandbox-first arbeiten
- Fehler systematisch untersuchen
- Recovery verifizieren
- Status und Fortschritt strukturiert melden
- Provenance und Audit berücksichtigen
- ESTABLISHED nur bei ausreichender kausaler Evidenz verwenden
- bei Unsicherheit UNKNOWN, UNVERIFIED oder HYPOTHESIS verwenden
- keine verborgene Chain-of-Thought ausgeben

## Trainingsformat

Die Daten liegen als JSONL mit einer `messages`-Spalte vor. Das Conversational-Format wird von TRL SFTTrainer direkt unterstützt.

## Referenz-Basismodell

Standardmäßig wird `Qwen/Qwen3-0.6B` verwendet. Das ist bewusst klein genug für reproduzierbare Entwicklungs- und Smoke-Trainings. `MODEL_ID` kann auf einen kompatiblen Instruct-Checkpoint gesetzt werden.

Das Training verwendet LoRA/PEFT. Das Basismodell bleibt unverändert; das Ergebnis ist ein versionierbarer Adapter.

## Ausführung

```bash
cd ml/huggingface
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python validate_dataset.py
python evaluate_dataset.py
MAX_STEPS=5 python train_sft.py
```

Für GPU kann `BF16=1` oder `FP16=1` gesetzt werden. Für normale Trainingsläufe `MAX_STEPS=0` verwenden.

## Hugging Face Hub

Ein Upload wird nicht automatisch durchgeführt. Dafür sind explizite Credentials und ein bewusst gewähltes Ziel-Repository erforderlich. Nach erfolgreicher lokaler Prüfung kann der erzeugte Adapter mit den normalen Hugging-Face-Hub-Werkzeugen veröffentlicht werden.

## Datenqualität

Der enthaltene Satz ist ein kleiner Gold- und Regression-Datensatz. Er ist nicht als Beweis für Produktionsqualität gedacht. Größere Datensätze müssen aus verifizierten Projektbeobachtungen, anonymisierten Ereignissen und gezielt erzeugten Evaluationsfällen aufgebaut werden.

Jedes neue Trainingssample sollte vor Aufnahme geprüft werden auf:
1. Sicherheitsverletzungen
2. erfundene Tatsachen
3. unzulässige Authority-Eskalation
4. Secret-Leaks
5. falsche Statusbehauptungen
6. fehlende Evidenz
7. widersprüchliche Antworten
8. Daten- oder Lizenzprobleme

## Sicherheitsprinzip

Training verändert Modellverhalten, aber keine Runtime-Authority. Das Modell erhält dadurch keine Root-Rechte, keine Secrets und keine Möglichkeit, Governance oder Execution Gates zu umgehen.

Die Datenstruktur orientiert sich an der aktuellen Hugging-Face-TRL-Dokumentation zu Conversational SFT und Tool Calling.
