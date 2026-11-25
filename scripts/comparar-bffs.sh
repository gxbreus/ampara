#!/usr/bin/env bash
# Mesmo animal, dois BFFs: mostra lado a lado o que a ONG (BFF Web) e o adotante (BFF Mobile)
# recebem, com login real nas contas da demo (scripts/seed.sh) e tudo pelo gateway.
#   ./scripts/comparar-bffs.sh            # compara o Thor
#   ./scripts/comparar-bffs.sh Mel        # outro animal do seed
#   AMPARA_GATEWAY=http://host:8000 ./scripts/comparar-bffs.sh
# Precisa de curl e python3. A senha das contas vem de SEED_SENHA_DEMO no .env.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
gateway="${AMPARA_GATEWAY:-http://localhost:8000}"
nome="${1:-Thor}"
senha="$(grep '^SEED_SENHA_DEMO=' "$raiz/.env" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$senha" ] || { echo "defina SEED_SENHA_DEMO no .env e rode ./scripts/seed.sh" >&2; exit 1; }

token() {
  curl -sf -m 15 -X POST "$gateway/auth/v1/sessoes" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"senha\":\"$senha\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])' \
    || { echo "login de $1 falhou: o gateway está no ar e o seed rodou?" >&2; exit 1; }
}
ong="$(token ong@ampara.dev)"
adotante="$(token adotante@ampara.dev)"

id="$(curl -sf -m 15 "$gateway/web/v1/animais" -H "Authorization: Bearer $ong" \
  | python3 -c "import sys,json; print(next((a['id'] for a in json.load(sys.stdin)['itens'] if a['nome']=='$nome'), ''))")"
[ -n "$id" ] || { echo "a ONG da demo não tem um animal chamado $nome" >&2; exit 1; }

temporario="$(mktemp -d)"
trap 'rm -rf "$temporario"' EXIT
curl -sf -m 15 "$gateway/web/v1/animais/$id" -H "Authorization: Bearer $ong" > "$temporario/web.json"
curl -sf -m 15 "$gateway/mobile/v1/animais/$id" -H "Authorization: Bearer $adotante" > "$temporario/mobile.json"
curl -sf -m 15 "$gateway/mobile/v1/animais?lat=-21.2453&lng=-44.9998&raioKm=20" -H "Authorization: Bearer $adotante" > "$temporario/busca.json"

python3 - "$temporario" "$nome" <<'EOF'
import json, sys
d, nome = sys.argv[1], sys.argv[2]
web = json.load(open(f"{d}/web.json")); mob = json.load(open(f"{d}/mobile.json"))
# a busca do mobile só lista animais DISPONIVEL (ou com pedido meu): reservado/adotado some dela
cartao = next((a for a in json.load(open(f"{d}/busca.json"))["itens"] if a["id"] == web["id"]), None)
tam = lambda o: len(json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode())

print(f"\n  {nome}: o mesmo animal, no mesmo instante\n")
print(f"  {'':34}{'BFF Web (ONG)':>16}{'BFF Mobile (adotante)':>24}")
print(f"  {'ficha completa (bytes)':34}{tam(web):>16}{tam(mob):>24}")
print(f"  {'item de lista / cartão (bytes)':34}{'—':>16}{(tam(cartao) if cartao else 'fora da busca'):>24}")
print(f"  {'solicitações do animal':34}{len(web['solicitacoes']):>16}{'só a minha':>24}")

so_web = sorted(set(web) - set(mob)); so_mob = sorted(set(mob) - set(web))
print(f"\n  só no web    : {', '.join(so_web)}")
print(f"  só no mobile : {', '.join(so_mob)}")

e = web["endereco"]
print("\n  onde o animal está")
print(f"    web    : {e['rua']}, {e['numero']} · {e['bairro']}, {e['cidade']}/{e['uf']} · lat {web['localizacao']['lat']}, lng {web['localizacao']['lng']}")
distancia = f"{cartao['distanciaKm']} km de distância" if cartao else f"status {mob['status']}, fora da busca"
print(f"    mobile : {mob['bairro']}, {mob['cidade']} · {distancia} (sem rua, número nem coordenada)")

print("\n  quem pediu")
if web["solicitacoes"]:
    for s in web["solicitacoes"]:
        a = s.get("adotante") or {}
        perfil = (a.get("perfil") or {})
        acoes = [k for k in s["_links"] if k != "self"]
        print(f"    web    : {a.get('nome', 'Identidade fora do ar')} · {s['estado']} · perfil completo={perfil.get('completo')} · ações: {', '.join(acoes) or 'nenhuma'}")
else:
    print("    web    : nenhuma solicitação ainda")
print(f"    mobile : só a do próprio adotante → minhaSolicitacao = {mob['minhaSolicitacao']}")

print(f"\n  quem cuida (mobile): {mob['responsavel']['nome']} · verificado={mob['responsavel']['verificado']}")
avisos = web.get("avisos") or mob.get("avisos")
print(f"  falha parcial agora: web={web.get('avisos')} mobile={mob.get('avisos')}\n" if avisos else "")
EOF
