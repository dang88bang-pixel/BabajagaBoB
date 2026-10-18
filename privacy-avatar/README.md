# Privacy Avatar

Isolierte, lokal-first Avatar-Komponente für BabajagaBoB.

## Datenschutzvertrag

1. Der Browser sendet Kamerabilder niemals an die Privacy-Avatar-API.
2. Rohframes gehen ausschließlich an den lokalen Dienst 127.0.0.1:8091.
3. Die API akzeptiert für Vision nur strukturierte Beobachtungen.
4. Bildfelder, Base64, Data-URLs und beliebige Zusatzfelder werden abgewiesen.
5. Browser-TTS ist der Standard; Audio wird nicht hochgeladen.
6. Externe Provider sind in dieser Komponente nicht eingebaut.
7. Remote-MCP muss später separat allowlisted und autorisiert werden.

## Verwendete Open-Source-Bausteine

Die Architektur wurde gegen mehrere vorhandene Projekte geprüft:

- jshsakura/mcp-local-vision: lokale Vision über llama.cpp, MIT.
- hikaneko/ai-avatar: selbst gehosteter Avatar mit lokalem LLM, Whisper, Kokoro und TalkingHead, MIT.
- josepeon/spatial-agent: technisch interessant für WebRTC/FastAPI/Three.js, aber im Repository als proprietär gekennzeichnet; daher kein Code-Copy.

Die neue Komponente ist eigenständig implementiert und übernimmt keine proprietären Spatial-Agent-Dateien.

## Start

Privacy Gateway:

    pip install -r privacy-avatar/requirements.txt
    uvicorn privacy_avatar.app:app --host 127.0.0.1 --port 8787

Lokale Vision:

    VLM_URL=http://127.0.0.1:8080/v1/chat/completions python privacy-avatar/local_vision.py

Das VLM muss auf demselben Rechner laufen. In Privacy Mode darf VLM_URL nicht auf einen Cloud-Anbieter zeigen.

## Security

Für öffentliche Bereitstellung muss die API hinter HTTPS/TLS betrieben werden und PRIVACY_AVATAR_TOKEN gesetzt sein. FastAPI dokumentiert HTTPS typischerweise über einen TLS-Termination-Proxy wie Caddy, Traefik oder Nginx.

Für MCP werden keine eingehenden Tokens an Upstream-Dienste durchgereicht. Die aktuelle MCP-Sicherheitsdokumentation verlangt Audience-Binding und verbietet Token-Passthrough.

## Test

    PYTHONPATH=. pytest -q privacy-avatar/tests

Die CI-Datei führt denselben Testlauf auf GitHub Actions aus.
