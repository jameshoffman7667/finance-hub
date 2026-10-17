FROM node:20.19-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20.19-alpine
LABEL org.opencontainers.image.title="finance-hub" \
      org.opencontainers.image.source="https://github.com/jameshoffman7667/finance-hub"
RUN apk add --no-cache tini
ENV NODE_ENV=production PORT=8070 DATA_DIR=/data FILES_DIR=/files TZ=America/Toronto
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# /data holds SQLite and backups; /files holds statements. Both must be writable by uid 1000 / gid 100.
RUN mkdir -p /data /files && chown 1000:100 /data /files
USER 1000:100
EXPOSE 8070
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
