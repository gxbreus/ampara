# Mesmo animal, dois BFFs

O BFF Web e o BFF Mobile devolvem o mesmo animal com formatos diferentes, porque atendem pessoas diferentes fazendo coisas diferentes. Este documento mostra o **Thor**, cão de porte médio da ONG Patas de Lavras, no mesmo instante, nas duas respostas.

**Momento do exemplo:** 17/11, logo depois das 15h. A Bruna Silva solicitou o Thor, a SAGA reservou o animal e a solicitação está em `AGUARDANDO_APROVACAO`. Uma solicitação anterior, do Carlos Souza, foi recusada.

| | BFF Web | BFF Mobile |
| --- | --- | --- |
| Quem pede | a ONG Patas de Lavras, dona do animal | a Bruna, adotante |
| Rota | `GET /web/v1/animais/{id}` | `GET /mobile/v1/animais/{id}` ou a lista de "minhas solicitações" |
| Serviços chamados | Animais (modelo de escrita), Adoção e Identidade | Animais (projeção de leitura) e Adoção |
| Tamanho da resposta | 1.865 bytes | 298 bytes |
| Contrato | [`bff-web.v1.yaml`](bff-web.v1.yaml) | `bff-mobile.v1.yaml` (#30) |

## Web: o que a ONG vê

```json
{
  "id": "65a2f1c4e8b9d3a7f0c1b2e9",
  "nome": "Thor",
  "especie": "CAO",
  "porte": "MEDIO",
  "idadeMeses": 36,
  "temperamento": [
    "dócil",
    "brincalhão"
  ],
  "fotos": [
    "https://exemplo.ampara.dev/fotos/thor-1.jpg",
    "https://exemplo.ampara.dev/fotos/thor-2.jpg"
  ],
  "fotoCapa": "https://exemplo.ampara.dev/fotos/thor-1.jpg",
  "localizacao": {
    "lat": -21.2453,
    "lng": -44.9998,
    "bairro": "Centro",
    "cidade": "Lavras"
  },
  "status": "RESERVADO",
  "historicoStatus": [
    {
      "status": "DISPONIVEL",
      "em": "2026-11-10T13:00:00Z",
      "por": "RESPONSAVEL"
    },
    {
      "status": "RESERVADO",
      "em": "2026-11-12T10:00:01Z",
      "por": "SAGA"
    },
    {
      "status": "DISPONIVEL",
      "em": "2026-11-13T09:30:01Z",
      "por": "SAGA"
    },
    {
      "status": "RESERVADO",
      "em": "2026-11-17T15:00:01Z",
      "por": "SAGA"
    }
  ],
  "atualizadoEm": "2026-11-17T15:00:01Z",
  "solicitacoes": [
    {
      "id": "7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17",
      "estado": "AGUARDANDO_APROVACAO",
      "desfecho": null,
      "expiraEm": "2026-11-20T15:00:00Z",
      "criadoEm": "2026-11-17T15:00:00Z",
      "adotante": {
        "id": "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55",
        "nome": "Bruna Silva",
        "cidade": "Lavras",
        "perfil": {
          "tipoMoradia": "CASA",
          "temQuintal": true,
          "outrosAnimais": false,
          "horasForaDeCasa": 4,
          "completo": true
        }
      },
      "_links": {
        "self": {
          "href": "/web/v1/solicitacoes/7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17"
        },
        "aprovar": {
          "href": "/web/v1/solicitacoes/7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17/aprovacao",
          "method": "POST"
        },
        "recusar": {
          "href": "/web/v1/solicitacoes/7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17/recusa",
          "method": "POST"
        }
      }
    },
    {
      "id": "3c9e5b1d-8a2f-4d7c-b6e0-9f1a2c3d4e5f",
      "estado": "RECUSADA",
      "desfecho": "RECUSADA",
      "expiraEm": "2026-11-15T10:00:00Z",
      "criadoEm": "2026-11-12T10:00:00Z",
      "adotante": {
        "id": "9b2d4f6a-1c3e-4a5b-8d7f-0e1a2b3c4d5e",
        "nome": "Carlos Souza",
        "cidade": "Lavras",
        "perfil": {
          "tipoMoradia": "APARTAMENTO",
          "temQuintal": false,
          "outrosAnimais": true,
          "horasForaDeCasa": 10,
          "completo": true
        }
      },
      "_links": {
        "self": {
          "href": "/web/v1/solicitacoes/3c9e5b1d-8a2f-4d7c-b6e0-9f1a2c3d4e5f"
        }
      }
    }
  ],
  "avisos": []
}
```

## Mobile: o que a Bruna vê

O `AnimalCard` tem exatamente os 8 campos definidos na #30. O BFF Mobile usa o mesmo cartão na busca e na lista de solicitações. Na busca, o Thor só aparece enquanto está `DISPONIVEL`.

```json
{
  "id": "65a2f1c4e8b9d3a7f0c1b2e9",
  "nome": "Thor",
  "fotoThumb": "https://exemplo.ampara.dev/fotos/thor-1-thumb.jpg",
  "porte": "MEDIO",
  "distanciaKm": 2.4,
  "cidade": "Lavras",
  "minhaSolicitacao": {
    "id": "7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17",
    "estado": "AGUARDANDO_APROVACAO"
  },
  "atualizadoEm": "2026-11-17T15:00:03Z"
}
```

## Campo a campo

| Campo | Web | Mobile | Por quê |
| --- | --- | --- | --- |
| `id`, `nome`, `porte` | sim | sim | identificam o animal nas duas telas |
| `especie`, `idadeMeses`, `temperamento` | sim | não | a ONG edita esses dados; no celular, a busca já filtra por espécie e porte, e o detalhe fica para a tela do animal |
| `fotos` (todas) e `fotoCapa` | sim | não | a ONG gerencia a galeria |
| `fotoThumb` (320 px) | não | sim | numa lista em rede móvel, só a miniatura |
| `localizacao` (coordenada exata) | sim | não | só o responsável vê onde o animal está; o adotante nunca recebe a coordenada (LGPD) |
| `distanciaKm`, `cidade` | não | sim | o adotante decide pela distância; ela é calculada a partir da localização dele, na projeção de leitura |
| `status`, `historicoStatus` | sim | não | a ONG acompanha reservas e liberações; o adotante só precisa saber da própria solicitação |
| `solicitacoes[]` com o `adotante` e o perfil | sim | não | a ONG avalia quem pediu; mandar isso ao celular exporia dados pessoais de outros adotantes |
| `_links` `aprovar` e `recusar` | sim | não | só o responsável decide (HATEOAS da Adoção, traduzido pelo BFF) |
| `minhaSolicitacao` | não | sim | o adotante vê o estado do próprio pedido; para a ONG o campo não faz sentido |
| `avisos[]` | sim | definido na #30 | o painel avisa qual serviço faltou numa resposta parcial |
| `atualizadoEm` | sim | sim | no web, vem do modelo de escrita; no mobile, da projeção, o que torna a defasagem do CQRS visível |

## Por que não um endpoint só

- **Privacidade.** A resposta do painel traz nome, cidade e perfil de cada adotante que pediu o animal, além da coordenada exata. Um endpoint compartilhado teria que esconder campos conforme quem pede, e um erro nessa regra vaza dados pessoais para qualquer adotante.
- **Modelos diferentes.** O web lê o modelo de escrita de Animais, que é a verdade atual e tem a coordenada exata. O mobile lê a projeção, que é otimizada para busca por raio e aceita alguns segundos de defasagem. São fontes diferentes de propósito (CQRS).
- **Custo de rede.** O cartão mobile tem 298 bytes, contra 1.865 do detalhe web. Uma página de 20 cartões cabe em cerca de 6 KB. No formato do web, passaria de 37 KB e ainda exigiria consultar a Identidade só para montar dados que o adotante não pode ver.
- **Ritmos diferentes.** O painel pode ganhar campos para a ONG sem mudar o app instalado nos celulares, e vice-versa. Cada BFF evolui com o seu cliente (ADR-005).
