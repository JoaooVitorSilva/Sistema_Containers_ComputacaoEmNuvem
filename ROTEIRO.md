# Sistema de Vendas — 3 contêineres (Docker Compose)

## O que é

| Contêiner | Imagem | Papel | Acesso |
|---|---|---|---|
| **web** | `nginx:alpine` | Front-end (HTML/CSS/JS) e **gateway**: repassa `/api/*` para a API | http://127.0.0.1:8080 |
| **api** | `node:22-alpine` | Microsserviço REST (Express): produtos, clientes, vendas, painel | http://127.0.0.1:3000 |
| **db** | `postgres:16-alpine` | Banco de dados. **Só a API acessa** (sem porta publicada) | rede interna |

Fluxo: navegador → **web** → **api** → **db**

Os contêineres se encontram **pelo nome do serviço**: o Nginx chama `http://api:3000` e a API conecta em `db:5432`. Quem cria essa rede interna é o Compose.

```
sistema-vendas/
├── docker-compose.yml     ← sobe os 3 contêineres juntos
├── db/
│   └── init.sql           ← tabelas + dados iniciais (roda na 1ª subida)
├── backend/               ← contêiner "api"
│   ├── Dockerfile
│   ├── package.json / package-lock.json
│   └── src/server.js
└── frontend/              ← contêiner "web"
    ├── Dockerfile
    ├── nginx.conf
    └── public/  (index.html, styles.css, app.js)
```

---

## 1. Subir o sistema (Windows)

1. Abra o **Docker Desktop** e espere aparecer **"Engine running"**.
2. Remova o contêiner da atividade anterior, que usa a porta 3000:
   ```
   docker rm -f produtos
   ```
3. Na pasta `sistema-vendas` (onde está o `docker-compose.yml`), abra o PowerShell e rode:
   ```
   docker compose up -d --build
   ```
   A primeira vez demora porque baixa as imagens do Postgres e do Nginx.
4. Confira:
   ```
   docker compose ps
   ```
   Os 3 serviços devem aparecer como `running`, e o `db` como `healthy`.
5. Abra **http://127.0.0.1:8080**. Use 127.0.0.1, porque `localhost` trava nesse PC.

> Não precisa rodar `npm install`: cada imagem instala as próprias dependências no `docker build`.

---

## 2. Comandos úteis

| Para quê | Comando |
|---|---|
| Ver os contêineres | `docker compose ps` |
| Ver as imagens criadas | `docker images` |
| Logs da API (cada requisição aparece) | `docker compose logs -f api` |
| Logs do banco | `docker compose logs db` |
| Parar tudo (mantém os dados) | `docker compose down` |
| Subir de novo | `docker compose up -d` |
| **Zerar o banco** (volta aos dados iniciais) | `docker compose down -v` e depois `docker compose up -d --build` |
| Recriar depois de mudar o código | `docker compose up -d --build` |
| Entrar no banco pelo terminal | `docker exec -it vendas-db psql -U vendas -d vendas` |

Dentro do `psql`: `\dt` lista as tabelas, `SELECT * FROM vendas;` mostra as vendas e `\q` sai.

---

## 3. Roteiro da apresentação (~5 min)

1. **Arquitetura.** Abra a tela *Arquitetura* no sistema. Os 3 cartões mostram status online e o tempo de ida e volta.
   No terminal, rode `docker compose ps` e `docker images`.
2. **Arquivos.** Mostre o `docker-compose.yml`, que traz os 3 serviços, o `depends_on`, o healthcheck, o volume e as portas. Mostre também os dois `Dockerfile`.
3. **Painel.** Faturamento, ticket médio, gráfico dos últimos 7 dias, mais vendidos e estoque baixo. Tudo vem do banco, via API.
4. **Nova venda.** Adicione produtos ao carrinho, escolha cliente e pagamento e finalize. O recibo aparece.
   Volte ao Painel: o faturamento e o estoque mudaram.
5. **Regra de negócio.** Tente vender mais do que o estoque: o botão bloqueia, e a API recusa com erro 409.
6. **Vendas.** Abra uma venda e clique em **Cancelar venda**: os itens voltam ao estoque (compensação).
7. **Produtos/Clientes.** Cadastre um produto e mostre que ele aparece na hora em *Nova venda*.
8. **Prova de que o banco é separado.** Rode:
   ```
   docker compose restart api
   ```
   Recarregue a página e veja que os dados continuam lá, porque estão no contêiner `db`, em um volume.
   Opcional: `docker compose stop db`. Na tela *Arquitetura*, o db fica **offline**. Depois, `docker compose start db`.
9. **API direto.** Abra http://127.0.0.1:3000/produtos (JSON puro). É o mesmo serviço da atividade anterior, agora com banco.

---

## 4. Explicação para o professor

> O sistema foi dividido em **três contêineres com responsabilidades separadas**, como no slide de componentes da arquitetura: cliente → gateway → serviço → banco.
>
> - O **web** (Nginx) entrega o front-end e funciona como **API Gateway**: o navegador só conversa com ele, e ele repassa as chamadas `/api` para o serviço.
> - A **api** (Node.js + Express) concentra as **regras de negócio**. Ela é dona dos dados e expõe endpoints **REST** com JSON (GET, POST, PUT, DELETE).
> - O **db** (PostgreSQL) guarda os dados e **só é acessado pela API**, seguindo o padrão *Database per Service*. Ele não tem porta publicada para fora.
>
> O **Docker Compose** sobe os três de uma vez, cria a rede interna (por isso um contêiner chama o outro pelo nome) e o **volume** que mantém os dados mesmo se o contêiner for recriado. O `healthcheck` com `depends_on` faz a API só iniciar quando o banco está pronto, e a API ainda tenta reconectar sozinha (resiliência).
>
> Uma venda é gravada numa **transação**: os itens e a baixa de estoque são salvos juntos, ou nada é salvo. O `SELECT ... FOR UPDATE` impede que duas vendas simultâneas vendam o mesmo item. O **cancelamento** devolve o estoque, como a etapa de compensação de uma Saga.
>
> Cada contêiner pode ser atualizado e escalado de forma independente. Num Kubernetes, cada um viraria um Deployment com seu Service.

---

## 5. Endpoints da API

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/health` | Status da API e do banco |
| GET | `/produtos?busca=` | Lista produtos ativos |
| GET | `/produtos/:id` | Um produto (404 se não existir) |
| POST | `/produtos` | Cadastra `{nome, categoria, preco, estoque}` |
| PUT | `/produtos/:id` | Atualiza |
| DELETE | `/produtos/:id` | Remove do catálogo (o histórico de vendas é mantido) |
| GET/POST | `/clientes` | Lista (com total gasto) / cadastra |
| PUT/DELETE | `/clientes/:id` | Atualiza / remove |
| GET | `/vendas` | Histórico |
| GET | `/vendas/:id` | Venda com itens |
| POST | `/vendas` | `{cliente_id, forma_pagamento, itens:[{produto_id, quantidade}]}` |
| POST | `/vendas/:id/cancelar` | Cancela e devolve o estoque |
| GET | `/dashboard` | Números do painel |

Pelo front, as mesmas rotas são chamadas com o prefixo `/api` (ex.: http://127.0.0.1:8080/api/produtos).

---

## Problemas comuns

- **"port is already allocated" (3000)**: o contêiner `produtos` da atividade anterior ainda existe. Rode `docker rm -f produtos`.
- **Página carrega infinitamente**: use `127.0.0.1` no lugar de `localhost`.
- **Tela mostra "API indisponível"**: rode `docker compose logs api`.
- **Mudei o `init.sql` e nada mudou**: ele só roda quando o volume é criado. Rode `docker compose down -v` e depois `docker compose up -d --build`.
- **Mudei o front ou a API e não apareceu**: rode `docker compose up -d --build` e recarregue com Ctrl+F5.
