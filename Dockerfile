FROM node:22-bookworm-slim

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3 fallback) and CA certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js decrypt_backup.js hash_password.js ./
COPY public ./public
COPY img ./img

RUN mkdir -p /app/data /app/backups

ENV NODE_ENV=production
ENV PORT=3000
ENV TRUST_PROXY=true
ENV DATA_DIRECTORY=/app/data
ENV BACKUP_DIRECTORY=/app/backups

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--use-system-ca", "server.js"]
