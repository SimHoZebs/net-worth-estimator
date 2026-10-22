# Reuse the same Node base as the production frontend build. This is a
# one-shot, network-disabled backup tool, not an additional runtime service.
FROM node:24-alpine
COPY dev/database.mjs /snapshot.mjs
USER node
ENTRYPOINT ["node", "/snapshot.mjs"]
