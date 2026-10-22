"""Rotas de escrita e gestão administrativa de animais (/v1/animais)."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.autenticacao import ResponsavelVerificadoDep, UsuarioDep
from app.dependencias import BancoEscrita, ClienteMongoEscrita
from app.dominio.animal import StatusAnimal
from app.problema import erro_sem_permissao
from app.repositorio.animais import (
    atualizar_animal,
    atualizar_status_animal,
    buscar_animais_em_lote,
    buscar_animal_por_id,
    cadastrar_animal,
    listar_animais_responsavel,
)
from app.schemas.animal import (
    AnimalCompleto,
    AtualizarAnimalEntrada,
    AtualizarStatusEntrada,
    NovoAnimalEntrada,
    PaginaAnimaisEscrita,
)

router = APIRouter(prefix="/v1/animais", tags=["Animais (Escrita)"])


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=AnimalCompleto,
    summary="Cadastra um novo animal",
)
async def criar_animal(
    entrada: NovoAnimalEntrada,
    response: Response,
    usuario: ResponsavelVerificadoDep,
    cliente: ClienteMongoEscrita,
    banco: BancoEscrita,
):
    animal = await cadastrar_animal(
        cliente=cliente,
        banco=banco,
        entrada=entrada,
        responsavel_id=usuario.sub,
        responsavel_nome="",
    )
    response.headers["Location"] = f"/v1/animais/{animal['id']}"
    return animal


@router.get(
    "",
    response_model=PaginaAnimaisEscrita,
    summary="Lista animais do responsável ou consulta em lote por IDs",
)
async def listar_ou_consultar_animais(
    usuario: UsuarioDep,
    banco: BancoEscrita,
    ids: Annotated[str | None, Query(description="IDs separados por vírgula (máximo 100)")] = None,
    responsavelId: Annotated[str | None, Query(description="UUID do responsável")] = None,
    status_filtro: Annotated[StatusAnimal | None, Query(alias="status")] = None,
    cursor: Annotated[str | None, Query(description="Cursor de paginação")] = None,
    limite: Annotated[int, Query(ge=1, le=100)] = 20,
):
    if ids is not None:
        lista_ids = [i.strip() for i in ids.split(",") if i.strip()]
        itens = await buscar_animais_em_lote(banco=banco, ids=lista_ids)
        return PaginaAnimaisEscrita(itens=itens, proximoCursor=None)

    id_alvo = responsavelId or usuario.sub
    if usuario.role != "ADMIN" and id_alvo != usuario.sub:
        raise erro_sem_permissao("Você não tem permissão para listar animais de outro responsável.")

    itens, proximo = await listar_animais_responsavel(
        banco=banco,
        responsavel_id=id_alvo,
        status_filtro=status_filtro,
        cursor=cursor,
        limite=limite,
    )
    return PaginaAnimaisEscrita(itens=itens, proximoCursor=proximo)


@router.get(
    "/{id}",
    response_model=AnimalCompleto,
    summary="Obtém os detalhes completos de um animal",
)
async def obter_animal(
    id: str,
    usuario: UsuarioDep,
    banco: BancoEscrita,
):
    eh_admin = usuario.role == "ADMIN"
    return await buscar_animal_por_id(
        banco=banco,
        animal_id=id,
        usuario_id=usuario.sub,
        eh_admin=eh_admin,
    )


@router.put(
    "/{id}",
    response_model=AnimalCompleto,
    summary="Atualiza dados cadastrais do animal",
)
async def editar_animal(
    id: str,
    entrada: AtualizarAnimalEntrada,
    usuario: UsuarioDep,
    cliente: ClienteMongoEscrita,
    banco: BancoEscrita,
):
    eh_admin = usuario.role == "ADMIN"
    return await atualizar_animal(
        cliente=cliente,
        banco=banco,
        animal_id=id,
        entrada=entrada,
        usuario_id=usuario.sub,
        eh_admin=eh_admin,
    )


@router.patch(
    "/{id}/status",
    response_model=AnimalCompleto,
    summary="Atualiza status operacional do animal",
)
async def alterar_status_animal(
    id: str,
    entrada: AtualizarStatusEntrada,
    usuario: UsuarioDep,
    cliente: ClienteMongoEscrita,
    banco: BancoEscrita,
):
    eh_admin = usuario.role == "ADMIN"
    return await atualizar_status_animal(
        cliente=cliente,
        banco=banco,
        animal_id=id,
        novo_status=entrada.status,
        motivo=entrada.motivo,
        usuario_id=usuario.sub,
        eh_admin=eh_admin,
    )
