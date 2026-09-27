# =============================================================================
# BabajagaBoB — Produktions-Image
# =============================================================================
# Baut die Anwendung und startet den Produktionsserver `server.mjs`
# (geordnetes Herunterfahren mit Drainage, siehe docs/OPERATIONS.md).
#
#   docker build -t babajagabob .
#   docker run -p 3000:3000 -v bob-data:/data babajagabob
#
# Der Start ist fail closed: ohne Creator-Bootstrap antwortet die API mit 428.
# Das Einmal-Secret liegt nach dem Start unter <BOB_STORAGE_DIR>/bootstrap-token
# (0600) bzw. in BOB_BOOTSTRAP_SECRET, wenn es von außen gesetzt wird —
# Details: docs/DEPLOYMENT.md und docs/BOOTSTRAP.md.
# =============================================================================

# --- Stufe 1: bauen -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Abhängigkeiten zuerst: diese Schicht bleibt bei reinen Codeänderungen erhalten.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Namespace-Rootfs für die Kernel-Isolation (Node + BusyBox, ~126 MB).
# Bewusst in der Baustufe: BusyBox kommt aus der devDependency und wird
# danach entfernt. Der Rootfs ist ein Laufzeitdatum wie `.bob-data`.
RUN bash scripts/build-ns-rootfs.sh /opt/bob/ns-rootfs

# Laufzeit braucht nur die Produktionsabhängigkeiten.
RUN npm prune --omit=dev --no-audit --no-fund

# --- Stufe 2: betreiben -------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    BOB_HOSTNAME=0.0.0.0 \
    BOB_STORAGE_DIR=/data \
    BOB_NS_ROOTFS=/opt/bob/ns-rootfs \
    BOB_SANDBOX_RUNTIME=local \
    BOB_SHUTDOWN_TIMEOUT_MS=15000

# bash            → scripts/*.sh (ns-exec.sh, cgroup-exec.sh, build-ns-rootfs.sh)
# util-linux      → unshare/setpriv (Kernel-Isolation, Ressourcenlimits)
# procps/curl     → Diagnose im Container (pkill, Healthcheck-Handprüfung)
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash util-linux procps curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --from=build --chown=node:node /opt/bob/ns-rootfs /opt/bob/ns-rootfs

# Zustand, Sandboxes, Snapshots, Evidenz — gehört auf ein Volume.
RUN mkdir -p /data && chown -R node:node /data /opt/bob

USER node
EXPOSE 3000
VOLUME ["/data"]

# `/api/auth` ist der einzige öffentliche Endpunkt und verrät keine Geheimnisse:
# er meldet nur, ob initialisiert werden muss. Damit ist der Healthcheck auch
# direkt nach dem Start aussagekräftig (vor dem Bootstrap: 200 + requiresBootstrap).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/auth').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.mjs"]
