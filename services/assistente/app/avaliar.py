"""Runner da avaliação do RAG (#70), conforme docs/llm/avaliacao-rag.md.

    python -m app.avaliar                      # perguntas com e sem RAG + planilha cega
    python -m app.avaliar --latencia 50        # também mede p50/p95 com cache frio e quente
    python -m app.avaliar --preco-entrada 0.15 --preco-saida 0.60 --preco-data 2026-11-26 \
        --taxa-cache 0.3

Roda dentro do container do Assistente (que já tem a base, as perguntas e o modelo de
embeddings): `kubectl exec -it deploy/assistente -n ampara -- python -m app.avaliar`.
Grava as saídas brutas em /tmp/avaliacao (ou --saida) e imprime o resumo em Markdown.

O que este runner NÃO faz, de propósito (o protocolo exige pessoas):
- não preenche as referências das perguntas nem dá notas: gera a planilha cega para os dois
  avaliadores humanos, com as respostas embaralhadas como A e B;
- não inventa tarifa: o custo só é calculado com o preço informado e datado na linha de
  comando; tokens que a API não devolveu ficam como desconhecidos, nunca zero.
"""

import argparse
import asyncio
import csv
import json
import math
import random
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

import yaml
from langchain_core.prompts import ChatPromptTemplate
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from app import conhecimento
from app.config import get_settings
from app.indice import Embeddings, Indice
from app.main import criar_llms
from app.rag import PROMPT, CitacaoInvalida, Rag, contexto, verificar_citacoes
from app.resiliencia import Cache, Resiliencia

# sem RAG: o mesmo modelo e as mesmas instruções de estilo, mas sem as fontes
PROMPT_SEM_RAG = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Você é o assistente da Ampara, uma plataforma de adoção responsável de animais. "
            "Responda em português do Brasil, em até 5 frases, de forma clara e acolhedora. "
            "Se não souber, diga que não sabe; nunca invente nomes de clínicas, horários, "
            "valores ou leis.",
        ),
        ("human", "{pergunta}"),
    ]
)


def percentil(valores: list[float], p: float) -> float | None:
    """Posto mais próximo: ceil(p*N) na série ordenada, índice começando em 1."""
    if not valores:
        return None
    ordenados = sorted(valores)
    return ordenados[max(1, math.ceil(p * len(ordenados))) - 1]


def tokens(mensagem) -> tuple[int | None, int | None]:
    uso = getattr(mensagem, "usage_metadata", None) or {}
    return uso.get("input_tokens"), uso.get("output_tokens")


async def gerar(llm, prompt, variaveis) -> dict:
    inicio = time.perf_counter()
    try:
        mensagem = await (prompt | llm).ainvoke(variaveis)
    except Exception as erro:  # noqa: BLE001 - erro fica registrado, não some
        return {"erro": f"{type(erro).__name__}: {erro}"[:300], "geracaoMs": None}
    entrada, saida = tokens(mensagem)
    return {
        "resposta": str(mensagem.content).strip(),
        "geracaoMs": round((time.perf_counter() - inicio) * 1000),
        "tokensEntrada": entrada,
        "tokensSaida": saida,
    }


def gravar_saidas(saida: Path, execucao: dict, registros: list, perguntas: list, semente: int):
    """Saídas brutas e a planilha cega (A/B embaralhados; o gabarito fica em outro arquivo)."""
    (saida / "execucao.json").write_text(json.dumps(execucao, ensure_ascii=False, indent=2))
    with open(saida / "respostas.jsonl", "w", encoding="utf-8") as f:
        for r in registros:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # planilha cega: A/B embaralhados por pergunta; o gabarito fica em outro arquivo
    sorteio = random.Random(semente)  # noqa: S311
    gabarito = []
    with open(saida / "planilha-cega.csv", "w", newline="", encoding="utf-8") as f:
        escrita = csv.writer(f)
        escrita.writerow(
            [
                "id",
                "pergunta",
                "referencia",
                "resposta_A",
                "resposta_B",
                "avaliador",
                "correcao_A",
                "fundamentacao_A",
                "alucinacao_A",
                "correcao_B",
                "fundamentacao_B",
                "alucinacao_B",
                "justificativa",
            ]
        )
        for p in perguntas:
            par = [r for r in registros if r["id"] == p["id"]]
            sorteio.shuffle(par)
            gabarito.append({"id": p["id"], "A": par[0]["modo"], "B": par[1]["modo"]})
            escrita.writerow(
                [
                    p["id"],
                    p["pergunta"],
                    p.get("referencia") or p.get("comportamento_esperado") or "",
                    par[0].get("resposta", par[0].get("erro")),
                    par[1].get("resposta", par[1].get("erro")),
                ]
                + [""] * 8
            )
    (saida / "gabarito-ab.json").write_text(json.dumps(gabarito, ensure_ascii=False, indent=2))


async def avaliar(args) -> None:
    s = get_settings()
    saida = Path(args.saida) / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    saida.mkdir(parents=True, exist_ok=True)

    qdrant = AsyncQdrantClient(url=s.qdrant_url, timeout=10, trust_env=False)
    redis = Redis.from_url(s.redis_url.get_secret_value(), decode_responses=True)
    trechos = conhecimento.carregar(s.kb_dir)
    embeddings = await asyncio.to_thread(Embeddings, s.embeddings_model)
    indice = Indice(qdrant, embeddings, conhecimento.versao(s.kb_dir))
    await indice.garantir(trechos)
    llms = criar_llms(s)
    llm = llms[0] if llms else None
    perguntas = yaml.safe_load((Path(args.perguntas)).read_text(encoding="utf-8"))

    execucao = {
        "data": datetime.now(UTC).isoformat(),
        "modelo": s.modelo if llm else None,
        "embeddings": s.embeddings_model,
        "baseVersao": indice.versao,
        "limiarRelevancia": s.limiar_relevancia,
        "trechos": s.trechos_por_resposta,
        "temperatura": 0.2,
    }
    registros, linhas_resumo = [], []
    acertos1 = acertos3 = com_fonte = 0
    for p in perguntas:
        inicio = time.perf_counter()
        achados = await indice.buscar(p["pergunta"], s.trechos_por_resposta)
        recuperacao_ms = round((time.perf_counter() - inicio) * 1000)
        relevantes = [r for r in achados if r.score >= s.limiar_relevancia]
        arquivos = [r.trecho.arquivo for r in achados]
        esperada = p.get("fonte_esperada")
        if esperada:
            com_fonte += 1
            acertos1 += bool(arquivos) and arquivos[0] == esperada
            acertos3 += esperada in arquivos
        base = {"id": p["id"], "categoria": p.get("categoria"), "pergunta": p["pergunta"]}
        recuperados = [
            {"arquivo": r.trecho.arquivo, "secao": r.trecho.secao, "score": round(r.score, 3)}
            for r in achados
        ]

        if llm is None:
            com = sem = {"erro": "sem LLM_API_KEY: geração não executada"}
        elif not relevantes:
            # fora do domínio: o serviço responde sem chamar o LLM; registra o que a API devolve
            com = {"resposta": "(recusa fora do domínio, sem LLM)", "geracaoMs": 0}
            sem = await gerar(llm, PROMPT_SEM_RAG, {"pergunta": p["pergunta"]})
        else:
            com = await gerar(
                llm, PROMPT, {"pergunta": p["pergunta"], "contexto": contexto(relevantes)}
            )
            # a mesma checagem de citação do serviço: registra se a resposta seria aceita
            if "resposta" in com:
                try:
                    v = verificar_citacoes(com["resposta"], relevantes)
                    com["checagemCitacao"] = "ok" if v.usados else "sem_cobertura"
                    com["fontesCitadas"] = [r.trecho.arquivo for r in v.usados]
                except CitacaoInvalida as erro:
                    com["checagemCitacao"] = f"recusada: {erro}"
            sem = await gerar(llm, PROMPT_SEM_RAG, {"pergunta": p["pergunta"]})

        # pausa entre perguntas: o plano gratuito do provedor limita requisições por minuto
        await asyncio.sleep(args.pausa)
        registros.append(
            {
                **base,
                "modo": "com_rag",
                "recuperacaoMs": recuperacao_ms,
                "recuperados": recuperados,
                **com,
            }
        )
        registros.append({**base, "modo": "sem_rag", "recuperacaoMs": None, **sem})
        linhas_resumo.append(
            f"| {p['id']} | {esperada or '—'} | {', '.join(dict.fromkeys(arquivos))} "
            f"| {achados[0].score:.2f} | {com.get('geracaoMs', '—')} | {sem.get('geracaoMs', '—')} "
            f"| {com.get('tokensEntrada', '—')}/{com.get('tokensSaida', '—')} "
            f"| {sem.get('tokensEntrada', '—')}/{sem.get('tokensSaida', '—')} |"
        )

    gravar_saidas(saida, execucao, registros, perguntas, args.semente)

    print(
        f"\n## Execução {execucao['data'][:16]}Z · modelo {execucao['modelo'] or 'sem chave'}"
        f" · base {indice.versao}\n"
    )
    print(
        f"Recuperação: fonte esperada em 1º lugar em {acertos1}/{com_fonte}; "
        f"entre as 3 primeiras em {acertos3}/{com_fonte}.\n"
    )
    print(
        "| Pergunta | Fonte esperada | Recuperadas (top 3) | Maior similaridade "
        "| Geração com RAG (ms) | Sem RAG (ms) | Tokens com RAG (entrada/saída) | Tokens sem RAG |"
    )
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    print("\n".join(linhas_resumo))

    if args.preco_entrada is not None and args.preco_saida is not None:
        for modo in ("com_rag", "sem_rag"):
            validos = [
                r for r in registros if r["modo"] == modo and r.get("tokensEntrada") is not None
            ]
            if validos:
                custo = (
                    sum(
                        r["tokensEntrada"] * args.preco_entrada
                        + r["tokensSaida"] * args.preco_saida
                        for r in validos
                    )
                    / 1e6
                )
                media = custo / len(validos)
                # custo mensal = custo por pergunta × volume × (1 − taxa de acerto do cache);
                # os embeddings rodam em CPU local e não têm custo de API
                fator = 1 - args.taxa_cache
                projecao = ", ".join(
                    f"{n:,} = US$ {media * n * fator:.2f}".replace(",", ".")
                    for n in (1_000, 10_000, 100_000)
                )
                print(
                    f"\nCusto {modo} (preço de {args.preco_data or 'data não informada'}, "
                    f"{len(validos)} chamadas com tokens): US$ {media:.6f} por pergunta; "
                    f"por mês com {args.taxa_cache:.0%} de acerto do cache: {projecao}."
                )

    if args.latencia and llm is not None:
        rag = Rag(indice, llms, [Resiliencia(s.timeout_llm_s) for _ in llms], Cache(redis, 3600), s)
        pergunta = next(p["pergunta"] for p in perguntas if p.get("fonte_esperada"))
        resultados = {}
        for cenario in ("cache_frio", "cache_quente"):
            tempos, contagem = [], {"normal": 0, "fallback": 0, "cache": 0, "erro": 0}
            for i in range(args.latencia):
                # cache frio: cada chamada é uma pergunta inédita (sufixo), nunca acerta o cache
                texto = (
                    f"{pergunta} (medição {datetime.now(UTC).timestamp()}-{i})"
                    if cenario == "cache_frio"
                    else pergunta
                )
                await asyncio.sleep(args.pausa)
                try:
                    r = await rag.responder(texto)
                except Exception:  # noqa: BLE001
                    contagem["erro"] += 1
                    continue
                contagem["cache" if r["cache"] else "fallback" if r["degradado"] else "normal"] += 1
                tempos.append(r["latenciaMs"])
            resultados[cenario] = {
                "p50": percentil(tempos, 0.5),
                "p95": percentil(tempos, 0.95),
                **contagem,
            }
        (saida / "latencia.json").write_text(json.dumps(resultados, indent=2))
        print(
            f"\nLatência ({args.latencia} chamadas por cenário, sequenciais, sem warm-up excluído):"
        )
        for cenario, r in resultados.items():
            print(
                f"- {cenario}: p50 {r['p50']} ms, p95 {r['p95']} ms · normal {r['normal']}, "
                f"cache {r['cache']}, fallback {r['fallback']}, erro {r['erro']}"
            )

    print(
        f"\nSaídas brutas em {saida}/ "
        "(execucao.json, respostas.jsonl, planilha-cega.csv, gabarito-ab.json)"
    )
    await qdrant.close()
    await redis.aclose()


def main() -> None:
    pasta = Path(__file__).resolve().parent.parent / "avaliacao"
    parser = argparse.ArgumentParser(description="Avaliação do RAG com e sem recuperação (#70)")
    parser.add_argument("--perguntas", default=str(pasta / "perguntas.yaml"))
    parser.add_argument("--saida", default=str(Path(tempfile.gettempdir()) / "avaliacao"))
    parser.add_argument(
        "--latencia", type=int, default=0, help="N chamadas por cenário (0 = não mede)"
    )
    parser.add_argument("--preco-entrada", type=float, help="US$ por milhão de tokens de entrada")
    parser.add_argument("--preco-saida", type=float, help="US$ por milhão de tokens de saída")
    parser.add_argument("--preco-data", help="data em que o preço oficial foi consultado")
    parser.add_argument(
        "--taxa-cache", type=float, default=0.0, help="taxa de acerto do cache na projeção (0 a 1)"
    )
    parser.add_argument("--semente", type=int, default=70)
    parser.add_argument(
        "--pausa", type=float, default=0, help="segundos entre chamadas (limite do plano gratuito)"
    )
    asyncio.run(avaliar(parser.parse_args()))


if __name__ == "__main__":
    main()
