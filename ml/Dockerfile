FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY ml/pyproject.toml ml/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/requirements.txt && \
    uv pip install --system --no-cache --compile-bytecode -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

COPY ml/*.py ./
RUN mkdir -p /data
ENV ML_MODEL_PATH=/data/ml.sqlite3 \
    PYTHONUNBUFFERED=1
EXPOSE 8766
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8766"]
