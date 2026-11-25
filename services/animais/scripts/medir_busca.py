"""Seed pela API real e latência da busca com pelo menos 1.000 animais projetados.

Execute apenas no ambiente local de demonstração. Requer DEMO_TOKEN_RESPONSAVEL
de ONG verificada e um JSON NovoAnimalEntrada. Não escreve diretamente na projeção.
"""

import argparse
import asyncio
import json
import math
import os
import time
from pathlib import Path

import httpx


async def medir(args):
    entrada = json.loads(Path(args.entrada).read_text(encoding="utf-8"))
    token = os.environ["DEMO_TOKEN_RESPONSAVEL"]
    headers = {"Authorization": f"Bearer {token}"}
    params = {"lat": args.lat, "lng": args.lng, "raioKm": 10, "limite": 20}
    ids = []
    async with httpx.AsyncClient(base_url=args.url, timeout=30) as cliente:
        # Escritas sequenciais para não confundir saturação do seed com busca.
        for i in range(args.animais):
            r = await cliente.post(
                "/v1/animais",
                json={**entrada, "nome": f"Carga CQRS {time.time_ns()} {i}"},
                headers=headers,
            )
            r.raise_for_status()
            ids.append(r.json()["id"])
        # Confere cada ID pelo modelo de leitura antes de aquecer a busca.
        limite = time.perf_counter() + 120
        pendentes = set(ids)
        while pendentes:
            for animal_id in list(pendentes):
                r = await cliente.get(f"/v1/animais/busca/{animal_id}")
                if r.status_code == 200:
                    pendentes.remove(animal_id)
                elif r.status_code != 404:
                    r.raise_for_status()
            if time.perf_counter() > limite:
                raise TimeoutError(f"{len(pendentes)} animais ainda sem projeção")
            if pendentes:
                await asyncio.sleep(0.05)
        for _ in range(20):
            r = await cliente.get("/v1/animais/busca", params=params)
            r.raise_for_status()
            if len(r.json()["itens"]) != 20:
                raise RuntimeError("Busca não retornou 20 itens durante o aquecimento")
        amostras = []
        for _ in range(args.amostras):
            inicio = time.perf_counter()
            r = await cliente.get("/v1/animais/busca", params=params)
            r.raise_for_status()
            if len(r.json()["itens"]) != 20:
                raise RuntimeError("Busca não retornou 20 itens durante a medição")
            amostras.append((time.perf_counter() - inicio) * 1000)
    ordenadas = sorted(amostras)
    resultado = {
        "animais_criados_e_projetados": len(ids),
        "amostras": len(amostras),
        "aquecimento": 20,
        "concorrencia": 1,
        "filtros": params,
        "amostras_ms": amostras,
        "p50_ms": ordenadas[math.ceil(0.50 * len(ordenadas)) - 1],
        "p95_ms": ordenadas[math.ceil(0.95 * len(ordenadas)) - 1],
        "max_ms": max(amostras),
    }
    print(json.dumps(resultado, indent=2))
    if resultado["p95_ms"] >= 500:
        raise SystemExit("Busca p95 excedeu o alvo de 500 ms")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8001")
    parser.add_argument("--entrada", required=True)
    parser.add_argument("--animais", type=int, default=1000)
    parser.add_argument("--amostras", type=int, default=200)
    parser.add_argument("--lat", type=float, default=-21.2468)
    parser.add_argument("--lng", type=float, default=-44.9998)
    args = parser.parse_args()
    if args.animais < 1000 or args.amostras < 20:
        parser.error("Use pelo menos 1.000 animais e 20 amostras")
    asyncio.run(medir(args))
