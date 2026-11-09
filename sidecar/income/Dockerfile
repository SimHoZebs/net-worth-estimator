FROM python:3.12-slim

WORKDIR /app
COPY sidecar/income/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY sidecar/income/*.py ./
RUN mkdir -p /data
ENV INCOME_MODEL_PATH=/data/income.sqlite3 \
    PYTHONUNBUFFERED=1
EXPOSE 8766
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8766"]
