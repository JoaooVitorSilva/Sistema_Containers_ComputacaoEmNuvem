# Roteiro — Sistema de Vendas com 3 microsserviços

## 1. Subir o sistema (Windows)

1. Abra o **Docker Desktop** e espere aparecer **"Engine running"**.
2. Abra o PowerShell na pasta do projeto (onde está o `docker-compose.yml`).
3. **Se você já rodou a versão antiga** (com o contêiner `api`), remova tudo dela, inclusive o banco antigo:
   ```
   docker compose down -v
   docker rm -f vendas-web vendas-api vendas-db
   ```
   Se aparecer "No such container", tudo bem.
4. Suba:
   ```
   docker compose up -d --build
   docker compose ps
   ```
   Devem aparecer 5 contêineres: `loja-web`, `loja-produtos`, `loja-clientes`, `loja-vendas` e `loja-db` (este como `healthy`).
5. Abra **http://127.0.0.1:8080**. Use 127.0.0.1, porque `localhost` trava nesse PC.

---

## 2. Comandos úteis

| Para quê | Comando |
|---|---|
| Ver os contêineres | `docker compose ps` |
| Ver as imagens | `docker images` |
| **Ver os serviços conversando** | `docker compose logs -f vendas` |
| Logs de todos | `docker compose logs -f` |
| Derrubar um serviço (resiliência) | `docker compose stop clientes` |
| Ligar de novo | `docker compose start clientes` |
| Parar tudo (mantém os dados) | `docker compose down` |
| Zerar os bancos | `docker compose down -v` e depois `docker compose up -d --build` |
| Ver os 3 bancos | `docker exec -it loja-db psql -U postgres -c "\l"` |
| Entrar no banco de vendas | `docker exec -it loja-db psql -U postgres -d vendas_db` |

---

## 3. Roteiro da demonstração

1. **Contêineres:** `docker compose ps`. São 5 contêineres e 3 microsserviços. O `loja-db` não tem porta publicada.
2. **Arquitetura:** a tela *Arquitetura* do sistema mostra o gateway, os 3 serviços conversando por HTTP e o banco, com status online e tempo de resposta.
3. **Os serviços conversando:** num segundo terminal, deixe rodando:
   ```
   docker compose logs -f vendas
   ```
   Faça uma venda em **Nova venda**. No log aparece:
   ```
   [vendas] -> clientes: GET /clientes/2 200
   [vendas] -> produtos: POST /produtos/reservar 200
   [vendas] POST /vendas -> 201
   ```
4. **Regra de negócio:** tente vender mais que o estoque. O serviço de produtos recusa (409) e nada é gravado.
5. **Compensação (Saga):** em *Vendas*, cancele uma venda. No log aparece `-> produtos: POST /produtos/devolver 200`, e o estoque volta.
6. **Resiliência:** rode `docker compose stop clientes`.
   - A tela *Arquitetura* mostra clientes **offline**.
   - Em *Nova venda*, ainda dá para vender como "Consumidor final".
   - Rode `docker compose start clientes` e tudo volta.
7. **Database per Service:** `docker exec -it loja-db psql -U postgres -c "\l"` mostra os 3 bancos, cada um com um dono diferente.
8. **Serviço direto:** abra http://127.0.0.1:3001/produtos. É o microsserviço de produtos respondendo sozinho, sem o gateway.

---

## 4. Explicação para a banca

> Dividimos o sistema em **três microsserviços**, cada um dono de uma parte do negócio:
>
> - **Produtos** cuida do catálogo e do estoque.
> - **Clientes** cuida do cadastro.
> - **Vendas** registra as vendas e é quem **coordena** os outros dois.
>
> Eles conversam por **HTTP com JSON** pela rede interna do Docker Compose, chamando uns aos outros pelo nome (`http://produtos:3000`).
>
> Quando uma venda acontece, o serviço de vendas pergunta ao de clientes se o cliente existe, pede ao de produtos para **reservar o estoque** e só então grava a venda. Se a gravação falhar, ele pede ao de produtos para **devolver** o estoque. Essa é a **compensação** do padrão **Saga**, que substitui a transação única que não existe entre bancos diferentes.
>
> Cada serviço tem **o próprio banco** (Database per Service). Usamos um único contêiner PostgreSQL com três bancos e um usuário por serviço, e um serviço não consegue acessar o banco do outro.
>
> Na frente fica o **Nginx como API Gateway**: o navegador só fala com ele, e ele encaminha `/api/produtos`, `/api/clientes` e `/api/vendas` para o serviço certo. As rotas internas, como reservar estoque, ficam bloqueadas para o navegador.
>
> Se um serviço cai, os outros continuam funcionando (**resiliência**), e cada um pode ser atualizado e escalado separadamente.

---

## 5. Endpoints

Pelo gateway, use o prefixo `/api` (ex.: http://127.0.0.1:8080/api/produtos).

**Produtos** (`produtos:3000`, porta 3001 no PC)

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/produtos?busca=` | Lista |
| GET | `/produtos/:id` | Um produto |
| GET | `/produtos/estoque-baixo` | Produtos com 5 unidades ou menos |
| POST / PUT / DELETE | `/produtos`, `/produtos/:id` | Cadastra, edita, remove do catálogo |
| POST | `/produtos/reservar` | *Interno:* confere e baixa o estoque (tudo ou nada) |
| POST | `/produtos/devolver` | *Interno:* devolve o estoque (compensação) |

**Clientes** (`clientes:3000`, porta 3002 no PC)

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/clientes` | Lista, com compras e total gasto (vindos de vendas) |
| GET | `/clientes/:id` | Um cliente (usado por vendas) |
| POST / PUT / DELETE | `/clientes`, `/clientes/:id` | Cadastra, edita, remove |

**Vendas** (`vendas:3000`, porta 3003 no PC)

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/vendas` | Histórico |
| GET | `/vendas/:id` | Venda com itens |
| POST | `/vendas` | `{cliente_id, forma_pagamento, itens:[{produto_id, quantidade}]}` |
| POST | `/vendas/:id/cancelar` | Cancela e devolve o estoque |
| GET | `/dashboard` | Números do painel |
| GET | `/vendas/resumo-clientes` | *Interno:* compras por cliente (usado por clientes) |

Todos os serviços têm `GET /health`. Pelo gateway, use `/api/health/produtos`, `/api/health/clientes` ou `/api/health/vendas`.

---

## Problemas comuns

- **"container name already in use"**: há contêineres de uma execução anterior. Rode `docker compose down` (ou `docker rm -f` com o nome que aparecer) e suba de novo.
- **"port is already allocated"**: outra coisa está usando a porta 8080, 3001, 3002 ou 3003. Veja com `docker ps`.
- **Página carrega infinitamente**: use `127.0.0.1` no lugar de `localhost`.
- **Tela mostra um serviço offline**: rode `docker compose ps` e `docker compose logs <serviço>`.
- **Mudei o SQL e nada mudou**: os scripts de `db/init` só rodam quando o volume é criado. Rode `docker compose down -v` e depois `docker compose up -d --build`.
