import jwt
import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.dependencias import (
    get_banco_escrita,
    get_cliente_mongo_escrita,
)


class MockCursor:
    def __init__(self, itens):
        self.itens = itens

    def sort(self, *args, **kwargs):
        return self

    def limit(self, n):
        self.itens = self.itens[:n]
        return self

    async def to_list(self, length=None):
        if length is not None:
            return self.itens[:length]
        return self.itens


class MockColecao:
    def __init__(self):
        self.documentos = {}

    async def find_one(self, filtro, session=None):
        for doc in self.documentos.values():
            bate = True
            for k, v in filtro.items():
                if k == "_id" and doc.get("_id") != v:
                    bate = False
                    break
                elif k != "_id" and doc.get(k) != v:
                    bate = False
                    break
            if bate:
                return dict(doc)
        return None

    async def insert_one(self, doc, session=None):
        doc_id = doc.get("_id") or ObjectId()
        doc["_id"] = doc_id
        self.documentos[str(doc_id)] = dict(doc)
        return type("InsertResult", (), {"inserted_id": doc_id})()

    async def update_one(self, filtro, update, session=None):
        doc = await self.find_one(filtro)
        if not doc:
            return type("UpdateResult", (), {"matched_count": 0, "modified_count": 0})()

        doc_mod = dict(self.documentos[str(doc["_id"])])
        if "$set" in update:
            for k, v in update["$set"].items():
                doc_mod[k] = v
        if "$push" in update:
            for k, v in update["$push"].items():
                lista = list(doc_mod.get(k, []))
                lista.append(v)
                doc_mod[k] = lista

        self.documentos[str(doc["_id"])] = doc_mod
        return type("UpdateResult", (), {"matched_count": 1, "modified_count": 1})()

    def find(self, filtro=None):
        filtro = filtro or {}
        resultado = []
        for doc in self.documentos.values():
            bate = True
            for k, v in filtro.items():
                if k == "_id":
                    if isinstance(v, dict) and "$in" in v:
                        if doc.get("_id") not in v["$in"]:
                            bate = False
                            break
                    elif isinstance(v, dict) and "$gt" in v:
                        if doc.get("_id") <= v["$gt"]:
                            bate = False
                            break
                    elif doc.get("_id") != v:
                        bate = False
                        break
                elif doc.get(k) != v:
                    bate = False
                    break
            if bate:
                resultado.append(dict(doc))
        return MockCursor(resultado)


class MockBanco:
    def __init__(self):
        self.animais = MockColecao()
        self.outbox = MockColecao()
        self.responsaveis = MockColecao()


class MockSessionContext:
    def __init__(self, cliente):
        self.cliente = cliente

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            # Rollback: restaura estado anterior das coleções
            self.cliente.banco.animais.documentos = dict(self.backup_animais)
            self.cliente.banco.outbox.documentos = dict(self.backup_outbox)
        return False

    async def start_transaction(self):
        self.backup_animais = dict(self.cliente.banco.animais.documentos)
        self.backup_outbox = dict(self.cliente.banco.outbox.documentos)
        return self


class MockClienteMongo:
    def __init__(self, banco):
        self.banco = banco

    def start_session(self):
        return MockSessionContext(self)


def gerar_token(sub="5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55", role="ONG"):
    # Token sem assinatura para testes com verificação desabilitada
    return jwt.encode(
        {"sub": sub, "role": role, "iss": "ampara-identidade"}, "secreta", algorithm="HS256"
    )


@pytest.fixture
def ambiente_mock(cliente: TestClient):
    banco = MockBanco()
    mock_cliente = MockClienteMongo(banco)

    # Configura responsável inicial verificado
    banco.responsaveis.documentos["5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"] = {
        "_id": "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55",
        "nome": "ONG Patas de Lavras",
        "role": "ONG",
        "cidade": "Lavras",
        "verificado": True,
    }

    cliente.app.dependency_overrides[get_banco_escrita] = lambda: banco
    cliente.app.dependency_overrides[get_cliente_mongo_escrita] = lambda: mock_cliente

    yield banco, mock_cliente

    cliente.app.dependency_overrides.clear()


PAYLOAD_ANIMAL = {
    "nome": "Thor",
    "especie": "CAO",
    "porte": "MEDIO",
    "sexo": "MACHO",
    "idadeMeses": 36,
    "temperamento": ["dócil", "brincalhão"],
    "descricao": "Resgatado e castrado.",
    "fotos": ["https://exemplo.ampara.dev/fotos/thor.jpg"],
    "localizacao": {
        "type": "Point",
        "coordinates": [-44.9998, -21.2453],
    },
    "endereco": {
        "rua": "Rua Santana",
        "numero": "120",
        "bairro": "Centro",
        "cidade": "Lavras",
        "uf": "MG",
        "cep": "37200-000",
    },
}


def test_cadastrar_animal_sucesso(cliente: TestClient, ambiente_mock):
    banco, _ = ambiente_mock
    token = gerar_token()

    resp = cliente.post(
        "/v1/animais", json=PAYLOAD_ANIMAL, headers={"Authorization": f"Bearer {token}"}
    )

    assert resp.status_code == 201
    dados = resp.json()
    assert dados["nome"] == "Thor"
    assert dados["status"] == "DISPONIVEL"
    assert dados["version"] == 1
    assert "Location" in resp.headers
    assert resp.headers["Location"] == f"/v1/animais/{dados['id']}"

    # Valida gravação atômica: 1 na coleção animais e 1 evento na outbox
    assert len(banco.animais.documentos) == 1
    assert len(banco.outbox.documentos) == 1

    evento = list(banco.outbox.documentos.values())[0]
    assert evento["type"] == "animal.criado"
    assert evento["payload"]["animalId"] == dados["id"]
    assert evento["payload"]["version"] == 1


def test_cadastrar_animal_sem_token_retorna_401(cliente: TestClient, ambiente_mock):
    resp = cliente.post("/v1/animais", json=PAYLOAD_ANIMAL)
    assert resp.status_code == 401
    assert resp.headers["content-type"] == "application/problem+json"


def test_cadastrar_animal_responsavel_nao_verificado_retorna_403(
    cliente: TestClient, ambiente_mock
):
    # Token de outro usuário que não está cadastrado em responsaveis
    token = gerar_token(sub="uuid-nao-verificado-999")
    resp = cliente.post(
        "/v1/animais", json=PAYLOAD_ANIMAL, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403
    assert resp.headers["content-type"] == "application/problem+json"


def test_tentar_mudar_manualmente_para_reservado_retorna_409(cliente: TestClient, ambiente_mock):
    token = gerar_token()
    cria_resp = cliente.post(
        "/v1/animais", json=PAYLOAD_ANIMAL, headers={"Authorization": f"Bearer {token}"}
    )
    animal_id = cria_resp.json()["id"]

    # Tentativa de definir RESERVADO manualmente
    resp = cliente.patch(
        f"/v1/animais/{animal_id}/status",
        json={"status": "RESERVADO"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 409
    assert resp.headers["content-type"] == "application/problem+json"
    detalhes = resp.json()
    assert detalhes["title"] == "Conflito de transição de status"


def test_editar_animal_de_outro_responsavel_retorna_403(cliente: TestClient, ambiente_mock):
    token_dono = gerar_token(sub="dono-original-123")
    banco, _ = ambiente_mock
    banco.responsaveis.documentos["dono-original-123"] = {
        "_id": "dono-original-123",
        "nome": "Dono Original",
        "role": "ONG",
        "verificado": True,
    }

    cria_resp = cliente.post(
        "/v1/animais", json=PAYLOAD_ANIMAL, headers={"Authorization": f"Bearer {token_dono}"}
    )
    animal_id = cria_resp.json()["id"]

    # Outro usuário tentando editar
    token_invasor = gerar_token(sub="invasor-456")
    resp = cliente.put(
        f"/v1/animais/{animal_id}",
        json={"nome": "Nome Modificado Indevidamente"},
        headers={"Authorization": f"Bearer {token_invasor}"},
    )

    assert resp.status_code == 403
    assert resp.headers["content-type"] == "application/problem+json"


def test_version_incrementa_a_cada_escrita(cliente: TestClient, ambiente_mock):
    token = gerar_token()
    banco, _ = ambiente_mock

    # 1. Cadastro -> version 1
    cria_resp = cliente.post(
        "/v1/animais", json=PAYLOAD_ANIMAL, headers={"Authorization": f"Bearer {token}"}
    )
    animal_id = cria_resp.json()["id"]
    assert cria_resp.json()["version"] == 1

    # 2. Edição cadastral (PUT) -> version 2
    put_resp = cliente.put(
        f"/v1/animais/{animal_id}",
        json={"nome": "Thor Atualizado"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["version"] == 2
    assert put_resp.json()["nome"] == "Thor Atualizado"

    # 3. Alteração de status (PATCH) -> version 3
    patch_resp = cliente.patch(
        f"/v1/animais/{animal_id}/status",
        json={"status": "EM_TRATAMENTO", "motivo": "Consulta de rotina"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["version"] == 3
    assert patch_resp.json()["status"] == "EM_TRATAMENTO"

    # Total de 3 eventos na outbox
    assert len(banco.outbox.documentos) == 3


def test_consulta_lote_com_mais_de_100_ids_retorna_422(cliente: TestClient, ambiente_mock):
    token = gerar_token()
    ids_101 = ",".join([str(ObjectId()) for _ in range(101)])

    resp = cliente.get(f"/v1/animais?ids={ids_101}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 422
    assert resp.headers["content-type"] == "application/problem+json"


def test_falha_na_transacao_faz_rollback_completo(cliente: TestClient, ambiente_mock):
    banco, _ = ambiente_mock
    token = gerar_token()

    # Simula erro fatal ao tentar gravar o evento na coleção outbox
    async def insert_one_falha(doc, session=None):
        raise RuntimeError("Falha de I/O na gravação do Outbox")

    banco.outbox.insert_one = insert_one_falha

    # Tenta cadastrar o animal esperando falha/500
    with pytest.raises(RuntimeError, match="Falha de I/O na gravação do Outbox"):
        cliente.post(
            "/v1/animais",
            json=PAYLOAD_ANIMAL,
            headers={"Authorization": f"Bearer {token}"},
        )

    # Rollback atômico: nenhum documento deve ter persistido em animais ou outbox
    assert len(banco.animais.documentos) == 0
    assert len(banco.outbox.documentos) == 0
