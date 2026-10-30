# Free-tier Casdoor wrapper. The pinned upstream image cannot read secrets from
# the environment, and free Render services have no disk or shell. This image
# reuses the pinned upstream binaries and renders /conf from environment
# variables at every boot into ephemeral storage. All state is disposable:
# each restart re-imports the same seed with fresh signing keys and subjects.
# The upstream target publishes the unchanged, pinned home-stack runtime to GHCR.
FROM casbin/casdoor:v4.23.0@sha256:e13c9aada231f7338a03ab0ae7054d0a9480e77283338ab9fc319d88fe2b3ce0 AS upstream

FROM upstream AS runtime

USER root
RUN mkdir -p /casdoor-template && chown 1000:1000 /casdoor-template \
    # Remove lsof: Casdoor's StopOldInstance parses `lsof -t -i :8000` and
    # SIGKILLs the first PID in its output. This image's lsof prints PID 1's
    # own file table for that query, so Casdoor would kill the container
    # supervisor (or itself). Without lsof the lookup safely finds nothing.
    && rm -f /usr/bin/lsof
USER 1000

COPY --chown=1000:1000 render/app.conf.sqlite.template /casdoor-template/app.conf.sqlite.template
COPY --chown=1000:1000 render/app.conf.postgres.template /casdoor-template/app.conf.postgres.template
COPY --chown=1000:1000 render/init_data.json.template /casdoor-template/init_data.json.template
COPY --chown=1000:1000 render/init_data.pg.json.template /casdoor-template/init_data.pg.json.template
COPY --chown=1000:1000 render/entrypoint.sh /casdoor-template/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/casdoor-template/entrypoint.sh"]
