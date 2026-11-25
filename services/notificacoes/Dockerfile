# Etapa de build: instala as dependências num virtualenv isolado. pip, wheels baixados e
# qualquer ferramenta de compilação ficam nesta etapa e não chegam na imagem final.
FROM python:3.12-slim AS builder

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
# o pip do virtualenv só serve para instalar: removê-lo tira ~13 MB da imagem final,
# que já tem o pip da imagem base
RUN pip install --no-cache-dir -r requirements.txt && \
    pip uninstall -y pip

# Etapa final: só o virtualenv e o código, rodando como usuário não-root.
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

EXPOSE 8002

# a imagem slim não tem curl nem wget: o próprio Python confere o /health
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8002/health')"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
