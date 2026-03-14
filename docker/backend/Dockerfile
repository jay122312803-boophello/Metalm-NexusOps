ARG BASE_IMAGE=registry.xuelangyun.com/shuzhi-amd64/alpine:3.20
FROM ${BASE_IMAGE}

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app/backend

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache python3 py3-pip && \
    python3 -m venv /opt/venv && \
    apk add --no-cache --virtual .build-deps build-base python3-dev && \
    /opt/venv/bin/pip install --no-cache-dir \
      fastapi \
      python-dotenv \
      requests \
      sqlalchemy \
      sqlmodel \
      "psycopg[binary]" \
      uvicorn && \
    apk del .build-deps

COPY backend/ /app/backend/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
