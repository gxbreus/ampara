"""Base de conhecimento: lê kb/*.md com o manifesto e divide em trechos citáveis (#66).

Cada arquivo da base tem um cabeçalho (título, fonte, seção de referência) e seções
"## ...". Cada seção vira um trecho: são textos curtos (um parágrafo), então dividir mais
quebraria a citação. Seções longas são cortadas com sobreposição pelo LangChain.

A versão da base é o hash do conteúdo: entra no nome da coleção do Qdrant e na chave do
cache. Mudou um texto, muda a versão; o índice é refeito e o cache antigo deixa de valer.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

TAMANHO_TRECHO = 900
SOBREPOSICAO = 120
IGNORADOS = {"fontes.md"}


@dataclass(frozen=True)
class Trecho:
    id: str  # estável: arquivo#seção#parte
    arquivo: str
    titulo: str
    secao: str
    url: str
    texto: str

    @property
    def origem(self) -> str:
        return f"kb/{self.arquivo}, seção {self.secao}"


def _manifesto(kb: Path) -> dict[str, dict]:
    arquivo = kb / "manifesto.json"
    if not arquivo.exists():
        return {}
    return {item["arquivo"]: item for item in json.loads(arquivo.read_text(encoding="utf-8"))}


def carregar(kb: Path) -> list[Trecho]:
    manifesto = _manifesto(kb)
    divisor = RecursiveCharacterTextSplitter(chunk_size=TAMANHO_TRECHO, chunk_overlap=SOBREPOSICAO)
    trechos: list[Trecho] = []
    for caminho in sorted(kb.glob("*.md")):
        if caminho.name in IGNORADOS:
            continue
        bruto = caminho.read_text(encoding="utf-8")
        meta = manifesto.get(caminho.name, {})
        titulo = meta.get("titulo") or bruto.splitlines()[0].lstrip("# ").strip()
        url = meta.get("url", "")
        for secao in re.split(r"\n## ", bruto)[1:]:
            cabecalho, _, corpo = secao.partition("\n")
            corpo = corpo.strip()
            if not corpo:
                continue
            for parte, pedaco in enumerate(divisor.split_text(corpo)):
                trechos.append(
                    Trecho(
                        id=f"{caminho.name}#{cabecalho.strip()}#{parte}",
                        arquivo=caminho.name,
                        titulo=titulo,
                        secao=cabecalho.strip(),
                        url=url,
                        texto=pedaco,
                    )
                )
    return trechos


def versao(kb: Path) -> str:
    resumo = hashlib.sha256()
    for caminho in sorted(kb.glob("*")):
        if caminho.is_file():
            resumo.update(caminho.name.encode())
            resumo.update(caminho.read_bytes())
    return resumo.hexdigest()[:12]
