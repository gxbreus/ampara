from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.dominio.animal import EspecieAnimal, PorteAnimal, SexoAnimal, StatusAnimal


class GeoPointExato(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["Point"] = "Point"
    coordinates: Annotated[list[float], Field(min_length=2, max_length=2)]


class Endereco(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rua: Annotated[str, Field(min_length=1)]
    numero: Annotated[str, Field(min_length=1)]
    complemento: str | None = None
    bairro: Annotated[str, Field(min_length=1)]
    cidade: Annotated[str, Field(min_length=1)]
    uf: Annotated[str, Field(min_length=2, max_length=2)]
    cep: Annotated[str, Field(pattern=r"^\d{5}-\d{3}$")]


class NovoAnimalEntrada(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nome: Annotated[str, Field(min_length=1, max_length=100)]
    especie: EspecieAnimal
    porte: PorteAnimal
    sexo: SexoAnimal
    idadeMeses: Annotated[int, Field(ge=0)]
    temperamento: list[str] = Field(default_factory=list)
    descricao: Annotated[str | None, Field(max_length=2000)] = None
    fotos: list[str] = Field(default_factory=list)
    localizacao: GeoPointExato
    endereco: Endereco


class AtualizarAnimalEntrada(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nome: Annotated[str | None, Field(min_length=1, max_length=100)] = None
    especie: EspecieAnimal | None = None
    porte: PorteAnimal | None = None
    sexo: SexoAnimal | None = None
    idadeMeses: Annotated[int | None, Field(ge=0)] = None
    temperamento: list[str] | None = None
    descricao: Annotated[str | None, Field(max_length=2000)] = None
    fotos: list[str] | None = None
    localizacao: GeoPointExato | None = None
    endereco: Endereco | None = None


class AtualizarStatusEntrada(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusAnimal
    motivo: Annotated[str | None, Field(max_length=500)] = None


class HistoricoStatusItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusAnimal
    motivo: str | None = None
    alteradoEm: datetime
    alteradoPor: str


class AnimalCompleto(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    responsavelId: str
    nome: str
    especie: EspecieAnimal
    porte: PorteAnimal
    sexo: SexoAnimal
    idadeMeses: int
    temperamento: list[str] = Field(default_factory=list)
    descricao: str | None = None
    fotos: list[str] = Field(default_factory=list)
    status: StatusAnimal
    localizacao: GeoPointExato
    endereco: Endereco
    historicoStatus: list[HistoricoStatusItem] = Field(default_factory=list)
    reservaSagaId: str | None = None
    version: int
    criadoEm: datetime
    atualizadoEm: datetime


class AnimalLoteItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    nome: str
    especie: EspecieAnimal
    porte: PorteAnimal
    fotoCapa: str | None = None
    status: StatusAnimal
    responsavelId: str


class PaginaAnimaisEscrita(BaseModel):
    model_config = ConfigDict(extra="forbid")

    itens: list[AnimalCompleto]
    proximoCursor: str | None = None
