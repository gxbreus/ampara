"""Cadastra 50 cópias de uma entrada e mede até aparecerem no read model."""

import argparse
import asyncio
import json
import math
import os
import time
from pathlib import Path

import httpx


async def medir(args):
    token = os.environ["DEMO_TOKEN_RESPONSAVEL"]
    entrada = json.loads(Path(args.entrada).read_text(encoding="utf-8"))
    amostras = []
    async with httpx.AsyncClient(base_url=args.url, timeout=10) as cliente:
        for i in range(50):
            inicio = time.perf_counter()
            resposta = await cliente.post(
                "/v1/animais",
                json={**entrada, "nome": f"Medição CQRS {i}"},
                headers={"Authorization": f"Bearer {token}"},
            )
            resposta.raise_for_status()
            animal_id = resposta.json()["id"]
            while time.perf_counter() - inicio < 30:
                detalhe = await cliente.get(f"/v1/animais/busca/{animal_id}")
                if detalhe.status_code == 200:
                    amostras.append((time.perf_counter() - inicio) * 1000)
                    break
                if detalhe.status_code != 404:
                    detalhe.raise_for_status()
                await asyncio.sleep(0.05)
            else:
                raise TimeoutError(f"Animal {animal_id} não apareceu em 30 s")
    p95 = sorted(amostras)[math.ceil(0.95 * len(amostras)) - 1]
    print(json.dumps({"amostras_ms": amostras, "p95_ms": p95}, indent=2))
    if p95 > 5000:
        raise SystemExit("Defasagem p95 excedeu 5 s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8001")
    parser.add_argument(
        "--entrada", required=True, help="JSON NovoAnimalEntrada; usa banco de demo"
    )
    asyncio.run(medir(parser.parse_args()))
