"""Seed de demonstração de Animais, pela API de escrita do próprio serviço.

Roda dentro do container (ou pod) do Animais, que já tem pymongo e PyJWT. Recebe a chave
privada do JWT em JWT_PRIVATE_KEY só durante a execução, para assinar o token de cada
responsável.

1. registra os três responsáveis (duas ONGs e uma protetora) como verificados na réplica
   `responsaveis` (o que o evento `conta.verificada` da Identidade faria);
2. cadastra os 20 animais com POST /v1/animais, cada um pelo seu responsável, que grava o
   animal e o evento no outbox;
3. o relay publica no RabbitMQ e o projetor atualiza o modelo de leitura (CQRS), que a
   busca pública do gateway consulta.

Os animais ficam em bairros de Lavras e em Ribeirão Vermelho, Ijaci e Perdões: com o raio
padrão de 10 km a partir do centro de Lavras aparecem os de Lavras e de Ribeirão Vermelho;
Ijaci (~11 km) e Perdões (~20 km) só com um raio maior.

Rodar de novo não duplica: o animal que o responsável já tem com o mesmo nome não é criado
de novo; se a descrição, o temperamento, as fotos, o porte, o lugar ou o endereço estão
diferentes do seed, o PUT /v1/animais/{id} (atualização parcial) os acerta. Um animal já
igual ao seed não recebe PUT (não muda a versão nem gera evento).
"""

import json
import os
import time
import urllib.parse
import urllib.request

import jwt
from pymongo import MongoClient

BASE = "http://localhost:8001/v1/animais"

ONG = "00000000-0000-4000-8000-0000000000a1"
ONG2 = "00000000-0000-4000-8000-0000000000a2"
PROTETORA = "00000000-0000-4000-8000-0000000000b1"

# os mesmos ids e nomes de scripts/seed/seed_identidade.js e apps/compartilhado/dev-auth.ts
RESPONSAVEIS = {
    ONG: ("ONG Patinhas de Lavras", "ONG"),
    ONG2: ("Abrigo Amigo Fiel", "ONG"),
    PROTETORA: ("Rita Protetora", "PROTETOR"),
}


def endereco(rua: str, numero: str, bairro: str, cidade: str, cep: str) -> dict:
    return {"rua": rua, "numero": numero, "bairro": bairro, "cidade": cidade, "uf": "MG", "cep": cep}


# Lugares: bairros de Lavras e o centro das cidades vizinhas, com coordenadas aproximadas.
# Distância ao centro de Lavras (-21.2453, -44.9998): Lavras até ~3 km, Ribeirão Vermelho
# ~9 km, Ijaci ~11 km e Perdões ~20 km.
LUGARES = {
    "Centro": (-21.2449, -45.0003, endereco("Rua Doutor Francisco Sales", "100", "Centro", "Lavras", "37200-000")),
    "Jardim Glória": (-21.2390, -44.9960, endereco("Rua Comandante Nélio", "215", "Jardim Glória", "Lavras", "37200-000")),
    "Santa Efigênia": (-21.2510, -45.0050, endereco("Rua Santa Efigênia", "48", "Santa Efigênia", "Lavras", "37200-000")),
    "Aquenta Sol": (-21.2300, -44.9900, endereco("Rua Aquenta Sol", "322", "Aquenta Sol", "Lavras", "37200-000")),
    "Cascatinha": (-21.2470, -44.9850, endereco("Rua da Cascatinha", "77", "Cascatinha", "Lavras", "37200-000")),
    "Água Limpa": (-21.2600, -45.0100, endereco("Rua Água Limpa", "510", "Água Limpa", "Lavras", "37200-000")),
    "Centenário": (-21.2420, -45.0080, endereco("Avenida Ernesto Matioli", "1200", "Centenário", "Lavras", "37200-000")),
    "Nossa Senhora de Lourdes": (-21.2350, -45.0150, endereco("Rua Nossa Senhora de Lourdes", "36", "Nossa Senhora de Lourdes", "Lavras", "37200-000")),
    "Jardim Floresta": (-21.2560, -44.9930, endereco("Rua das Acácias", "91", "Jardim Floresta", "Lavras", "37200-000")),
    "Vila Ester": (-21.2530, -45.0000, endereco("Rua Vila Ester", "140", "Vila Ester", "Lavras", "37200-000")),
    "Jardim Campestre": (-21.2240, -45.0020, endereco("Rua dos Ipês", "260", "Jardim Campestre", "Lavras", "37200-000")),
    "Ribeirão Vermelho": (-21.1880, -45.0620, endereco("Rua Padre Clemente", "55", "Centro", "Ribeirão Vermelho", "37264-000")),
    "Ijaci": (-21.1706, -44.9261, endereco("Rua Coronel Pedro Ribeiro", "120", "Centro", "Ijaci", "37205-000")),
    "Perdões": (-21.0906, -45.0897, endereco("Rua Saturnino de Pádua", "300", "Centro", "Perdões", "37260-000")),
}

# (nome, responsável, espécie, porte, sexo, idade em meses, temperamento, lugar, descrição)
ANIMAIS = [
    # ONG Patinhas de Lavras: os oito animais originais e mais três
    ("Paçoca", ONG, "CAO", "MEDIO", "FEMEA", 24, ["dócil", "brincalhona", "sociável"], "Centro",
     "Paçoca foi encontrada ainda magrinha na rodoviária de Lavras e hoje é a alegria do abrigo. "
     "Está vacinada, vermifugada e castrada. Adora crianças e convive bem com outros cães."),
    ("Thor", ONG, "CAO", "GRANDE", "MACHO", 48, ["protetor", "calmo", "leal"], "Jardim Glória",
     "Thor vivia preso numa corrente num lote vazio até ser resgatado por uma denúncia de vizinhos. "
     "Vacinado e castrado, é tranquilo dentro de casa e um ótimo companheiro de caminhada. "
     "Prefere ser o único cão da casa e se dá bem com crianças maiores."),
    ("Mel", ONG, "GATO", "PEQUENO", "FEMEA", 8, ["curiosa", "brincalhona", "carinhosa"], "Santa Efigênia",
     "Mel chegou com a ninhada, numa caixa deixada na porta de uma clínica veterinária. "
     "Já tomou as vacinas da idade e está castrada. Brinca o dia todo e se dá bem com outros gatos."),
    ("Biscoito", ONG, "CAO", "PEQUENO", "MACHO", 6, ["filhote", "agitado", "brincalhão"], "Aquenta Sol",
     "Biscoito foi resgatado com os irmãos numa obra no Aquenta Sol. Já tomou a primeira dose da "
     "vacina e será castrado com a idade certa (compromisso no termo de adoção). "
     "Cheio de energia, ideal para uma família com quintal e crianças."),
    ("Luna", ONG, "GATO", "PEQUENO", "FEMEA", 36, ["independente", "tranquila", "observadora"], "Cascatinha",
     "Luna foi devolvida ao abrigo quando a antiga família se mudou para fora do país. "
     "Vacinada e castrada, usa a caixa de areia direitinho. Gosta de colo no tempo dela e "
     "convive bem com gatos calmos; com cães, prefere distância."),
    ("Bolt", ONG, "CAO", "MEDIO", "MACHO", 18, ["energético", "sociável", "brincalhão"], "Água Limpa",
     "Bolt foi encontrado correndo atrás de carros na Água Limpa, sem coleira. "
     "Vacinado e castrado, precisa de passeios diários e de um tutor ativo. "
     "Faz amizade com qualquer cão e é ótimo com crianças."),
    ("Nina", ONG, "CAO", "GRANDE", "FEMEA", 120, ["idosa", "carinhosa", "tranquila"], "Centenário",
     "Nina passou anos como cão de guarda de um sítio e foi entregue ao abrigo quando o dono adoeceu. "
     "Vacinada e castrada, tem artrose leve e toma suplemento. Muito doce, ideal para quem quer "
     "uma companheira calma; aceita bem crianças e outros cães."),
    ("Frajola", ONG, "GATO", "MEDIO", "MACHO", 60, ["tranquilo", "dorminhoco", "carinhoso"], "Nossa Senhora de Lourdes",
     "Frajola apareceu no telhado de uma escola e ficou por lá até a equipe da ONG resgatá-lo. "
     "Vacinado, castrado e testado negativo para FIV e FeLV. Calmo e caseiro, convive bem com "
     "outros gatos e com crianças tranquilas."),
    ("Caramelo", ONG, "CAO", "MEDIO", "MACHO", 30, ["dócil", "companheiro", "sociável"], "Jardim Floresta",
     "Caramelo é o clássico vira-lata caramelo: foi achado dormindo na porta de uma padaria do "
     "Jardim Floresta. Vacinado e castrado, anda bem na guia e é gentil com crianças, cães e até gatos."),
    ("Pipoca", ONG, "GATO", "PEQUENO", "FEMEA", 3, ["filhote", "curiosa", "brincalhona"], "Centro",
     "Pipoca foi resgatada com poucos dias de vida e cresceu num lar temporário, na mamadeira. "
     "Já tomou a primeira dose da vacina e será castrada aos seis meses. "
     "Acostumada com gente e com outros gatos, está pronta para um lar com telas nas janelas."),
    ("Tobias", ONG, "CAO", "PEQUENO", "MACHO", 132, ["idoso", "calmo", "apegado"], "Vila Ester",
     "Tobias ficou sozinho depois que a tutora faleceu e foi trazido pelos vizinhos. "
     "Vacinado e castrado, tem o focinho grisalho e enxerga um pouco menos. Gosta de sofá, de "
     "passeios curtos e de gente calma; convive bem com outros cães pequenos."),
    # Abrigo Amigo Fiel: animais em Perdões, Ijaci e Ribeirão Vermelho
    ("Sol", ONG2, "CAO", "GRANDE", "FEMEA", 36, ["alegre", "inteligente", "protetora"], "Perdões",
     "Sol foi resgatada à beira da Fernão Dias, perto de Perdões, com uma pata machucada que já "
     "está curada. Vacinada e castrada, aprende comandos rápido e precisa de espaço para correr. "
     "Ótima com crianças; com outros cães, se dá melhor com machos."),
    ("Duquesa", ONG2, "GATO", "MEDIO", "FEMEA", 156, ["idosa", "tranquila", "independente"], "Perdões",
     "Duquesa tem 13 anos e foi entregue ao abrigo quando a família não pôde mais cuidar dela. "
     "Vacinada e castrada, faz exames de rotina dos rins. Quer um canto quieto e um colo de vez em "
     "quando; melhor numa casa sem crianças pequenas e sem cães."),
    ("Bento", ONG2, "CAO", "PEQUENO", "MACHO", 4, ["filhote", "brincalhão", "curioso"], "Ijaci",
     "Bento e os irmãos foram deixados numa caixa na estrada de Ijaci. Já tomou a primeira vacina "
     "e está vermifugado; a castração é compromisso do termo de adoção. "
     "Adora morder brinquedos e vai crescer bem numa família com crianças."),
    ("Dona Flor", ONG2, "CAO", "GRANDE", "FEMEA", 144, ["idosa", "dorminhoca", "carinhosa"], "Ijaci",
     "Dona Flor vivia solta na praça de Ijaci e era cuidada pelos moradores até ir para o abrigo. "
     "Vacinada e castrada, tem 12 anos e passa boa parte do dia cochilando ao sol. "
     "Muito mansa com crianças e com outros cães."),
    ("Fumaça", ONG2, "GATO", "MEDIO", "MACHO", 24, ["observador", "carinhoso", "tranquilo"], "Ribeirão Vermelho",
     "Fumaça foi resgatado de um galpão da antiga estação ferroviária de Ribeirão Vermelho. "
     "Vacinado, castrado e testado negativo para FIV e FeLV. Desconfiado no começo, depois não sai "
     "do colo; convive bem com outros gatos."),
    # Rita Protetora: protetora independente em Lavras e Ribeirão Vermelho
    ("Chico", PROTETORA, "GATO", "PEQUENO", "MACHO", 10, ["brincalhão", "comilão", "sociável"], "Jardim Campestre",
     "Chico pedia comida na porta da Rita até ela perceber que ele não tinha casa. "
     "Vacinado e castrado, brinca com qualquer coisa que role pelo chão. "
     "Muito sociável com gatos, cães e crianças."),
    ("Jade", PROTETORA, "GATO", "MEDIO", "FEMEA", 48, ["elegante", "falante", "carinhosa"], "Centenário",
     "Jade, uma siamesa, foi abandonada grávida num condomínio do Centenário; os filhotes já foram "
     "todos adotados. Vacinada e castrada, mia para conversar e gosta de rotina. "
     "Prefere ser a única gata, mas é paciente com crianças."),
    ("Rex", PROTETORA, "CAO", "MEDIO", "MACHO", 60, ["leal", "atento", "calmo"], "Jardim Glória",
     "Rex foi atropelado às margens da BR-265 e passou dois meses em recuperação com a Rita. "
     "Vacinado e castrado, anda sem nenhuma sequela. É atento e calmo, um bom cão de companhia "
     "para adultos; convive bem com cadelas."),
    ("Amora", PROTETORA, "GATO", "PEQUENO", "FEMEA", 14, ["tímida", "doce", "tranquila"], "Ribeirão Vermelho",
     "Amora foi resgatada de um bueiro em Ribeirão Vermelho depois de dois dias chorando. "
     "Vacinada e castrada, é tímida com visitas e muito doce com quem conhece. "
     "Convive bem com outros gatos e prefere casa sem cães agitados."),
]

# Fotos do Wikimedia Commons com licença livre; créditos em docs/assets/creditos-fotos.md.
# A mesma lista está em apps/compartilhado/fotos-demo.ts, usada pelos dados simulados dos apps.
FOTOS = {
    "Paçoca": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/12/Cachorro_esperando_na_ado%C3%A7%C3%A3o_2_20240623-DSC03735_01.jpg/960px-Cachorro_esperando_na_ado%C3%A7%C3%A3o_2_20240623-DSC03735_01.jpg",
    "Thor": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/Young_mixed-breed_dog_%28aka%29.jpg/960px-Young_mixed-breed_dog_%28aka%29.jpg",
    "Mel": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bd/Golden_tabby_and_white_kitten_n01.jpg/960px-Golden_tabby_and_white_kitten_n01.jpg",
    "Biscoito": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Brown-white_mixed-breed_puppy_2.JPG/960px-Brown-white_mixed-breed_puppy_2.JPG",
    "Luna": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Grey_and_white_cat.jpg/960px-Grey_and_white_cat.jpg",
    "Bolt": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2f/Rottweiler_and_other_dog%2C_running.jpg/960px-Rottweiler_and_other_dog%2C_running.jpg",
    "Nina": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/47/Elderly_irish_setter.png/500px-Elderly_irish_setter.png",
    "Frajola": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d2/Tuxedo-patterned_black_and_white_cat_on_gravel_path_2011_%28cropped%29.jpg/960px-Tuxedo-patterned_black_and_white_cat_on_gravel_path_2011_%28cropped%29.jpg",
    "Caramelo": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/Caramelo_dog_59.jpg/960px-Caramelo_dog_59.jpg",
    "Pipoca": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Tabby_Kitten_on_Blue_Throw.jpg/960px-Tabby_Kitten_on_Blue_Throw.jpg",
    "Tobias": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Cute_Small_Senior_Mixed-Breed_Dog.jpg/960px-Cute_Small_Senior_Mixed-Breed_Dog.jpg",
    "Sol": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/70/German_Shepherd_Border_Collie_mix.jpg/960px-German_Shepherd_Border_Collie_mix.jpg",
    "Duquesa": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/32/Tired_20-year-old_cat.jpg/960px-Tired_20-year-old_cat.jpg",
    "Bento": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/df/Mixed_breed_puppy.jpg/960px-Mixed_breed_puppy.jpg",
    "Dona Flor": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/009_Sleepy_senior_dog_-_old_mixed_breed_dog_in_Cuba.jpg/960px-009_Sleepy_senior_dog_-_old_mixed_breed_dog_in_Cuba.jpg",
    "Fumaça": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/A_blue_%28grey%29_cat_2018_%28cropped_2022%29.jpg/960px-A_blue_%28grey%29_cat_2018_%28cropped_2022%29.jpg",
    "Chico": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/Ginger_kitten_with_an_orange_rubber_rugby.jpg/960px-Ginger_kitten_with_an_orange_rubber_rugby.jpg",
    "Jade": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/Siamese_cat%2C_female.jpg/960px-Siamese_cat%2C_female.jpg",
    "Rex": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Dog_hybrid_from_Venezuela.jpg/960px-Dog_hybrid_from_Venezuela.jpg",
    "Amora": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b7/Black-Cat-Sitia-Crete-Greece-3.jpg/960px-Black-Cat-Sitia-Crete-Greece-3.jpg",
}


def token(conta_id: str, role: str) -> str:
    chave = os.environ["JWT_PRIVATE_KEY"].replace("\\n", "\n")
    agora = int(time.time())
    reivindicacoes = {"iss": "ampara-identidade", "sub": conta_id, "role": role, "iat": agora, "exp": agora + 900}
    return jwt.encode(reivindicacoes, chave, algorithm="RS256")


def chamar(metodo: str, url: str, autorizacao: str, corpo: dict | None = None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", f"Bearer {autorizacao}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"null")


def listar(autorizacao: str) -> list[dict]:
    """Todos os animais do responsável do token, seguindo o cursor."""
    itens, cursor = [], None
    while True:
        url = f"{BASE}?limite=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        pagina = chamar("GET", url, autorizacao)
        itens += pagina.get("itens", [])
        cursor = pagina.get("proximoCursor")
        if not cursor:
            return itens


def dados_do_seed(especie, porte, sexo, idade, temperamento, lugar, descricao, nome) -> dict:
    lat, lng, end = LUGARES[lugar]
    return {
        "especie": especie,
        "porte": porte,
        "sexo": sexo,
        "idadeMeses": idade,
        "temperamento": temperamento,
        "descricao": descricao,
        "fotos": [FOTOS[nome]],
        "localizacao": {"type": "Point", "coordinates": [lng, lat]},
        "endereco": end,
    }


def diferencas(atual: dict, desejado: dict) -> dict:
    """Só os campos que mudaram; o endereço compara os campos que o seed define."""
    mudou = {}
    for campo, valor in desejado.items():
        if campo == "endereco":
            if any((atual.get("endereco") or {}).get(k) != v for k, v in valor.items()):
                mudou[campo] = valor
        elif campo == "localizacao":
            if [round(c, 6) for c in (atual.get("localizacao") or {}).get("coordinates", [])] != [round(c, 6) for c in valor["coordinates"]]:
                mudou[campo] = valor
        elif atual.get(campo) != valor:
            mudou[campo] = valor
    return mudou


def main() -> None:
    cliente = MongoClient(os.environ["ANIMAIS_MONGO_URL"])
    banco = cliente.get_default_database()
    for conta_id, (nome, _) in RESPONSAVEIS.items():
        banco.responsaveis.update_one(
            {"_id": conta_id},
            {"$set": {"id": conta_id, "nome": nome, "verificado": True}},
            upsert=True,
        )

    criados = atualizados = iguais = 0
    for conta_id, (_, role) in RESPONSAVEIS.items():
        autorizacao = token(conta_id, role)
        existentes = {a["nome"]: a for a in listar(autorizacao)}
        for nome, dono, especie, porte, sexo, idade, temperamento, lugar, descricao in ANIMAIS:
            if dono != conta_id:
                continue
            desejado = dados_do_seed(especie, porte, sexo, idade, temperamento, lugar, descricao, nome)
            atual = existentes.get(nome)
            if atual is None:
                chamar("POST", BASE, autorizacao, {"nome": nome, **desejado})
                criados += 1
                continue
            mudou = diferencas(atual, desejado)
            if mudou:
                chamar("PUT", f"{BASE}/{atual['id']}", autorizacao, mudou)
                atualizados += 1
            else:
                iguais += 1
    print(f"seed animais: {criados} criados, {atualizados} atualizados, {iguais} já iguais ao seed ({len(ANIMAIS)} no total)")


if __name__ == "__main__":
    main()
