# Etapa de build: instala as dependências em um ambiente virtual isolado.
FROM python:3.12-slim AS builder

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Etapa final: copia apenas o ambiente virtual e o código, rodando como usuário não-root.
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN groupadd -g 1000 appuser && \
    useradd -u 1000 -g appuser -s /bin/sh appuser

COPY --from=builder /opt/venv /opt/venv
COPY app ./app

USER appuser

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
