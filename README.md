# Sistema de Vendas — Microsserviços em contêineres

Sistema de vendas com **3 microsserviços que conversam entre si** (Produtos, Clientes e Vendas), um API Gateway e um banco PostgreSQL, todos orquestrados pelo **Docker Compose**.
Projeto da disciplina de Computação em Nuvem (UniSENAI).

```
                         ┌──────────────────────────┐
  Navegador ──► :8080 ──►│ web (Nginx · API Gateway) │
                         └────────────┬─────────────┘
              /api/produtos    /api/vendas    /api/clientes
                    ▼               ▼                ▼
              ┌──────────┐ HTTP ┌─────────┐ HTTP ┌──────────┐
              │ produtos │◄─────│ vendas  │─────►│ clientes │
              └────┬─────┘      └────┬────┘      └────┬─────┘
                   ▼                 ▼                ▼
            ┌──────────────────────────────────────────────┐
            │ db (PostgreSQL): produtos_db · vendas_db · clientes_db │
            └──────────────────────────────────────────────┘
```

| Contêiner | Imagem | Papel | Porta |
|---|---|---|---|
| `loja-web` | `nginx:alpine` | Front-end e **API Gateway**: envia cada `/api/...` ao serviço dono do recurso | 8080 |
| `loja-produtos` | `node:22-alpine` | **Microsserviço de produtos**: catálogo e estoque (reserva e devolução) | 3001 |
| `loja-clientes` | `node:22-alpine` | **Microsserviço de clientes**: cadastro; pede a vendas o resumo de compras | 3002 |
| `loja-vendas` | `node:22-alpine` | **Microsserviço de vendas**: orquestra a venda chamando clientes e produtos | 3003 |
| `loja-db` | `postgres:16-alpine` | Um contêiner com **3 bancos**, um por serviço, cada um com usuário próprio | interna |

## Como os serviços conversam

Uma venda é uma **Saga orquestrada** pelo serviço de vendas:

1. `vendas → clientes`: `GET /clientes/:id`, para saber se o cliente existe
2. `vendas → produtos`: `POST /produtos/reservar`, que confere e baixa o estoque numa transação
3. `vendas` grava a venda no `vendas_db`
4. Se o passo 3 falhar, ocorre a **compensação** `vendas → produtos` (`POST /produtos/devolver`), e o estoque volta

Cancelar uma venda também é compensação: o serviço de vendas pede a produtos para devolver o estoque e só então marca a venda como cancelada.

O serviço de clientes chama `vendas → GET /vendas/resumo-clientes` para mostrar compras e total gasto de cada cliente.
As rotas internas (`reservar`, `devolver`, `resumo-clientes`) são bloqueadas no gateway: só os serviços as usam, pela rede interna.

**Database per Service:** cada serviço só tem acesso ao próprio banco (`produtos_user` não consegue nem conectar no `vendas_db`). Por isso a venda guarda o nome do cliente e do produto no momento da compra, em vez de uma chave estrangeira para outro banco.

**Resiliência:** se um serviço cair, os outros continuam. Sem o serviço de clientes, o caixa vende como "Consumidor final". Sem vendas, a lista de clientes aparece sem os números. Sem produtos, a venda é recusada sem gravar nada.

## Como executar

Pré-requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows com WSL 2) ou Docker Engine (Linux).

```bash
docker compose up -d --build
docker compose ps
```

Acesse **http://127.0.0.1:8080**. Cada serviço também responde direto, por exemplo em http://127.0.0.1:3001/produtos.

| Comando | O que faz |
|---|---|
| `docker compose logs -f vendas` | Mostra ao vivo as chamadas do serviço de vendas aos outros (`-> produtos`, `-> clientes`) |
| `docker compose stop clientes` | Derruba um serviço para mostrar a resiliência (`start` para voltar) |
| `docker compose down` | Para tudo (os dados ficam no volume) |
| `docker compose down -v` | Para e apaga os bancos (voltam aos dados iniciais) |

## Estrutura

```
├── docker-compose.yml        # 5 contêineres, rede, volume e healthcheck
├── db/init/                  # cria os 3 bancos, os usuários e os dados iniciais
│   ├── 01-bancos.sql
│   ├── 02-produtos.sql
│   ├── 03-clientes.sql
│   └── 04-vendas.sql
├── services/
│   ├── produtos/             # microsserviço de produtos (Dockerfile + src/server.js)
│   ├── clientes/             # microsserviço de clientes
│   └── vendas/               # microsserviço de vendas (orquestrador)
└── frontend/                 # contêiner web
    ├── Dockerfile
    ├── nginx.conf            # API Gateway
    └── public/               # index.html, styles.css, app.js
```

O passo a passo da apresentação e a lista de endpoints estão em [ROTEIRO.md](ROTEIRO.md).
