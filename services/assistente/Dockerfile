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

# o modelo de embeddings (~220 MB, ONNX) é baixado aqui e vai pronto na imagem: o pod roda
# com o sistema de arquivos somente leitura e a demo pode estar sem internet (#66)
ARG EMBEDDINGS_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('${EMBEDDINGS_MODEL}', cache_dir='/opt/modelos')"

# Etapa final: só o virtualenv e o código, rodando como usuário não-root.
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FASTEMBED_CACHE_PATH=/opt/modelos \
    HF_HUB_OFFLINE=1

RUN groupadd -g 1000 appuser && \
    useradd -u 1000 -g appuser -s /bin/sh appuser

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/modelos /opt/modelos
COPY app ./app
# base de conhecimento (#66) e perguntas da avaliação (#70)
COPY kb ./kb
COPY avaliacao ./avaliacao

USER appuser

EXPOSE 8003

# a imagem slim não tem curl nem wget: o próprio Python confere o /health
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8003/health')"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
