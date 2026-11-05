# Sistema de Vendas — Computação em Nuvem

Sistema de vendas em arquitetura de microsserviços com **3 contêineres** orquestrados pelo **Docker Compose**.
Projeto da disciplina de Computação em Nuvem (UniSENAI).

```
Navegador ──► web (Nginx :8080) ──► api (Node.js :3000) ──► db (PostgreSQL)
```

| Contêiner | Imagem base | Papel |
|---|---|---|
| `vendas-web` | `nginx:alpine` | Front-end (HTML/CSS/JS) e gateway: repassa `/api/*` para a API |
| `vendas-api` | `node:22-alpine` | API REST (Express): produtos, clientes, vendas e painel |
| `vendas-db` | `postgres:16-alpine` | Banco de dados; acessível só pela API, pela rede interna |

## Funcionalidades

- **Painel** com faturamento, ticket médio, gráfico dos últimos 7 dias, mais vendidos e estoque baixo
- **Nova venda (PDV)** com carrinho, cliente e forma de pagamento
- **Histórico de vendas** com cancelamento que devolve os itens ao estoque
- **Cadastro de produtos e clientes** (criar, editar, excluir)
- **Tela de arquitetura** mostrando o status dos 3 contêineres em tempo real

Cada venda é gravada numa transação: a venda, os itens e a baixa de estoque são salvos juntos, ou nada é salvo.

## Como executar

Pré-requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows com WSL 2) ou Docker Engine (Linux).

```bash
docker compose up -d --build
docker compose ps
```

Acesse **http://127.0.0.1:8080**.

| Comando | O que faz |
|---|---|
| `docker compose logs -f api` | Mostra as requisições da API ao vivo |
| `docker compose down` | Para tudo (os dados ficam no volume) |
| `docker compose down -v` | Para e apaga o banco (volta aos dados iniciais) |

## Estrutura

```
├── docker-compose.yml     # define os 3 serviços, rede, volume e healthcheck
├── db/init.sql            # tabelas + dados iniciais
├── backend/               # contêiner "api"
│   ├── Dockerfile
│   └── src/server.js
└── frontend/              # contêiner "web"
    ├── Dockerfile
    ├── nginx.conf
    └── public/            # index.html, styles.css, app.js
```

O passo a passo da apresentação e a lista de endpoints estão em [ROTEIRO.md](ROTEIRO.md).
