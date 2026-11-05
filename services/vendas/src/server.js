// =========================================================
// Microsserviço de VENDAS  (contêiner "vendas")
// Dono das vendas. Único que acessa o vendas_db.
// Conversa com: clientes (valida o cliente) e produtos (reserva e
// devolve estoque). Orquestra a venda como uma SAGA:
//   1. valida o cliente          -> serviço de clientes
//   2. reserva o estoque         -> serviço de produtos
//   3. grava a venda             -> vendas_db
//   se o passo 3 falhar: COMPENSA devolvendo o estoque (passo 2 desfeito)
// =========================================================
const express = require('express');
const { Pool, types } = require('pg');

types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));

const SERVICO = 'vendas';
const PORT = Number(process.env.PORT || 3000);
const PRODUTOS_URL = process.env.PRODUTOS_URL || 'http://produtos:3000';
const CLIENTES_URL = process.env.CLIENTES_URL || 'http://clientes:3000';

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'vendas_user',
  password: process.env.DB_PASSWORD || 'vendas123',
  database: process.env.DB_NAME || 'vendas_db',
  // "hoje" e "por dia" no horário de Brasília
  options: `-c timezone=${process.env.APP_TZ || 'America/Sao_Paulo'}`,
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () =>
    console.log(`[${SERVICO}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - inicio}ms)`)
  );
  next();
});

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const FORMAS_PAGAMENTO = ['pix', 'dinheiro', 'credito', 'debito'];

function inteiroPositivo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, `${campo} inválido`);
  return n;
}

// Chamada HTTP a outro microsserviço. Serviço fora do ar -> erro 503.
async function chamarServico(nome, metodo, url, corpo) {
  const inicio = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.log(`[${SERVICO}] -> ${nome}: ${metodo} ${new URL(url).pathname} FALHOU (${e.message})`);
    throw new ErroHttp(503, `Serviço de ${nome} indisponível`);
  }
  console.log(`[${SERVICO}] -> ${nome}: ${metodo} ${new URL(url).pathname} ${res.status} (${Date.now() - inicio}ms)`);
  let dados = null;
  try { dados = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, ok: res.ok, dados };
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servico: SERVICO, status: 'ok', banco: 'ok' });
  } catch (e) {
    res.status(503).json({ servico: SERVICO, status: 'ok', banco: 'indisponível' });
  }
});

// ---------------------------------------------------------
// Consultas
// ---------------------------------------------------------
app.get('/vendas', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.total, v.forma_pagamento, v.status, v.criado_em,
            v.cliente_id, v.cliente_nome AS cliente,
            COALESCE(SUM(i.quantidade), 0) AS itens
       FROM vendas v
       LEFT JOIN itens_venda i ON i.venda_id = v.id
      GROUP BY v.id
      ORDER BY v.criado_em DESC
      LIMIT 200`
  );
  res.json(rows);
});

// API interna: usada pelo serviço de clientes (o gateway bloqueia para o navegador)
app.get('/vendas/resumo-clientes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cliente_id, COUNT(*) AS compras, SUM(total) AS total_gasto
       FROM vendas
      WHERE status = 'concluida' AND cliente_id IS NOT NULL
      GROUP BY cliente_id`
  );
  res.json(rows);
});

app.get('/vendas/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const venda = await pool.query(
    `SELECT id, total, forma_pagamento, status, criado_em, cliente_id, cliente_nome AS cliente
       FROM vendas WHERE id = $1`,
    [id]
  );
  if (!venda.rows.length) throw new ErroHttp(404, 'Venda não encontrada');
  const itens = await pool.query(
    `SELECT produto_id, produto_nome AS nome, quantidade, preco_unitario, subtotal
       FROM itens_venda WHERE venda_id = $1 ORDER BY id`,
    [id]
  );
  res.json({ ...venda.rows[0], itens: itens.rows });
});

// ---------------------------------------------------------
// Registrar venda (SAGA orquestrada)
// ---------------------------------------------------------
app.post('/vendas', async (req, res) => {
  const { cliente_id, forma_pagamento = 'pix', itens } = req.body || {};
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroHttp(400, 'A venda precisa ter ao menos um item');
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento)) throw new ErroHttp(400, 'Forma de pagamento inválida');
  const itensPedido = itens.map(i => ({
    produto_id: inteiroPositivo(i.produto_id, 'produto_id'),
    quantidade: inteiroPositivo(i.quantidade, 'quantidade'),
  }));

  // Passo 1: o cliente existe? (serviço de clientes)
  let clienteNome = 'Consumidor final';
  let clienteId = null;
  if (cliente_id) {
    clienteId = inteiroPositivo(cliente_id, 'cliente_id');
    const r = await chamarServico('clientes', 'GET', `${CLIENTES_URL}/clientes/${clienteId}`);
    if (r.status === 404) throw new ErroHttp(400, 'Cliente não encontrado');
    if (!r.ok) throw new ErroHttp(502, 'Erro ao consultar o serviço de clientes');
    clienteNome = r.dados.nome;
  }

  // Passo 2: reservar o estoque (serviço de produtos). Ele devolve nome e preço.
  const reserva = await chamarServico('produtos', 'POST', `${PRODUTOS_URL}/produtos/reservar`, { itens: itensPedido });
  if (!reserva.ok) {
    const status = [400, 409].includes(reserva.status) ? reserva.status : 502;
    throw new ErroHttp(status, reserva.dados?.erro || 'Erro ao reservar o estoque');
  }
  const reservados = reserva.dados.itens;

  // Passo 3: gravar a venda no vendas_db. Se falhar, compensa o passo 2.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const linhas = reservados.map(r => ({ ...r, subtotal: Math.round(r.preco * r.quantidade * 100) / 100 }));
    const total = Math.round(linhas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;

    const { rows: [venda] } = await client.query(
      `INSERT INTO vendas (cliente_id, cliente_nome, total, forma_pagamento)
       VALUES ($1, $2, $3, $4) RETURNING id, total, forma_pagamento, status, criado_em`,
      [clienteId, clienteNome, total, forma_pagamento]
    );
    for (const l of linhas) {
      await client.query(
        `INSERT INTO itens_venda (venda_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [venda.id, l.produto_id, l.nome, l.quantidade, l.preco, l.subtotal]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ...venda, cliente: clienteNome });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`[${SERVICO}] Falha ao gravar a venda; compensando a reserva de estoque`);
    await chamarServico('produtos', 'POST', `${PRODUTOS_URL}/produtos/devolver`, { itens: itensPedido })
      .catch(err => console.error(`[${SERVICO}] Compensação falhou:`, err.message));
    throw e;
  } finally {
    client.release();
  }
});

// Cancelar = COMPENSAÇÃO: pede ao serviço de produtos para devolver o estoque
app.post('/vendas/:id/cancelar', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT status FROM vendas WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new ErroHttp(404, 'Venda não encontrada');
    if (rows[0].status === 'cancelada') throw new ErroHttp(409, 'Venda já está cancelada');

    const { rows: itens } = await client.query(
      'SELECT produto_id, quantidade FROM itens_venda WHERE venda_id = $1', [id]
    );
    // Só marca como cancelada se o estoque foi devolvido de verdade
    const r = await chamarServico('produtos', 'POST', `${PRODUTOS_URL}/produtos/devolver`, { itens });
    if (!r.ok) throw new ErroHttp(502, 'Não foi possível devolver o estoque; venda não cancelada');

    await client.query(`UPDATE vendas SET status = 'cancelada' WHERE id = $1`, [id]);
    await client.query('COMMIT');
    res.json({ id, status: 'cancelada' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------
// Painel: números das vendas + estoque baixo (serviço de produtos)
// ---------------------------------------------------------
app.get('/dashboard', async (req, res) => {
  const estoqueBaixo = chamarServico('produtos', 'GET', `${PRODUTOS_URL}/produtos/estoque-baixo?limite=5`)
    .then(r => (r.ok ? r.dados : null))
    .catch(() => null);

  const [resumo, hoje, porDia, top, baixo] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS vendas, COALESCE(SUM(total), 0) AS faturamento,
              COALESCE(ROUND(AVG(total), 2), 0) AS ticket_medio
         FROM vendas WHERE status = 'concluida'`
    ),
    pool.query(
      `SELECT COUNT(*) AS vendas, COALESCE(SUM(total), 0) AS faturamento
         FROM vendas WHERE status = 'concluida' AND criado_em::date = CURRENT_DATE`
    ),
    pool.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia, COALESCE(SUM(v.total), 0) AS total
         FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day') d
         LEFT JOIN vendas v ON v.criado_em::date = d::date AND v.status = 'concluida'
        GROUP BY d ORDER BY d`
    ),
    pool.query(
      `SELECT i.produto_id AS id, MAX(i.produto_nome) AS nome,
              SUM(i.quantidade) AS quantidade, SUM(i.subtotal) AS total
         FROM itens_venda i
         JOIN vendas v ON v.id = i.venda_id AND v.status = 'concluida'
        GROUP BY i.produto_id
        ORDER BY total DESC
        LIMIT 5`
    ),
    estoqueBaixo,
  ]);

  res.json({
    faturamento: resumo.rows[0].faturamento,
    vendas: resumo.rows[0].vendas,
    ticket_medio: resumo.rows[0].ticket_medio,
    hoje: hoje.rows[0],
    por_dia: porDia.rows,
    top_produtos: top.rows,
    estoque_baixo: baixo || [],
    estoque_disponivel: baixo !== null,
  });
});

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
app.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error(`[${SERVICO}]`, err);
  res.status(500).json({ erro: 'Erro interno no serviço de vendas' });
});

async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      console.log(`[${SERVICO}] Conectado ao banco vendas_db`);
      return;
    } catch (e) {
      console.log(`[${SERVICO}] Banco indisponível (tentativa ${i}/${tentativas}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Não foi possível conectar ao banco');
}

aguardarBanco()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`[${SERVICO}] Microsserviço de vendas na porta ${PORT}`)))
  .catch(err => { console.error(err.message); process.exit(1); });
