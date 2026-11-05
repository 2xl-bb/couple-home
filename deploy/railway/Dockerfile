FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PERSIST_DIR=/persist
COPY --chown=1000:1000 app/ ./app/
COPY --chown=1000:1000 --chmod=0644 start.mjs ./start.mjs
COPY --chown=1000:1000 LICENSE THIRD_PARTY_NOTICES.md ./
EXPOSE 3000
CMD ["node", "start.mjs"]
