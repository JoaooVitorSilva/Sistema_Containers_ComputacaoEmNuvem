// =========================================================
// API do Sistema de Vendas  (contêiner "api")
// Regras de negócio + acesso EXCLUSIVO ao banco (contêiner "db")
// =========================================================
const express = require('express');
const { Pool, types } = require('pg');

// NUMERIC do Postgres chega como texto; converte para número
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
// COUNT/SUM inteiros (bigint) também
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));

const PORT = Number(process.env.PORT || 3000);

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'vendas',
  password: process.env.DB_PASSWORD || 'vendas123',
  database: process.env.DB_NAME || 'vendas',
  // "hoje" e "por dia" no horário de Brasília, mesmo com o contêiner em UTC
  options: `-c timezone=${process.env.APP_TZ || 'America/Sao_Paulo'}`,
});

const app = express();
app.use(express.json());

// Log simples de cada requisição (observabilidade básica)
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () =>
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - inicio}ms)`)
  );
  next();
});

// Erro de negócio com status HTTP
class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const FORMAS_PAGAMENTO = ['pix', 'dinheiro', 'credito', 'debito'];

function inteiroPositivo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, `${campo} inválido`);
  return n;
}

function validarProduto(body) {
  const nome = String(body.nome || '').trim();
  const categoria = String(body.categoria || 'Geral').trim() || 'Geral';
  const preco = Number(body.preco);
  const estoque = Number(body.estoque ?? 0);
  if (!nome) throw new ErroHttp(400, 'Nome do produto é obrigatório');
  if (!Number.isFinite(preco) || preco < 0) throw new ErroHttp(400, 'Preço inválido');
  if (!Number.isInteger(estoque) || estoque < 0) throw new ErroHttp(400, 'Estoque inválido');
  return { nome, categoria, preco, estoque };
}

function validarCliente(body) {
  const nome = String(body.nome || '').trim();
  if (!nome) throw new ErroHttp(400, 'Nome do cliente é obrigatório');
  return {
    nome,
    email: String(body.email || '').trim() || null,
    telefone: String(body.telefone || '').trim() || null,
  };
}

// ---------------------------------------------------------
// Saúde do serviço
// ---------------------------------------------------------
app.get('/', (req, res) => {
  res.json({ mensagem: 'API do Sistema de Vendas funcionando!' });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ api: 'ok', banco: 'ok' });
  } catch (e) {
    res.status(503).json({ api: 'ok', banco: 'indisponível', detalhe: e.message });
  }
});

// ---------------------------------------------------------
// Produtos
// ---------------------------------------------------------
app.get('/produtos', async (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const { rows } = await pool.query(
    `SELECT id, nome, categoria, preco, estoque
       FROM produtos
      WHERE ativo = TRUE
        AND ($1 = '' OR nome ILIKE '%' || $1 || '%' OR categoria ILIKE '%' || $1 || '%')
      ORDER BY id`,
    [busca]
  );
  res.json(rows);
});

app.get('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rows } = await pool.query(
    'SELECT id, nome, categoria, preco, estoque FROM produtos WHERE id = $1 AND ativo = TRUE',
    [id]
  );
  if (!rows.length) throw new ErroHttp(404, 'Produto não encontrado');
  res.json(rows[0]);
});

app.post('/produtos', async (req, res) => {
  const p = validarProduto(req.body);
  const { rows } = await pool.query(
    `INSERT INTO produtos (nome, categoria, preco, estoque)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nome, categoria, preco, estoque`,
    [p.nome, p.categoria, p.preco, p.estoque]
  );
  res.status(201).json(rows[0]);
});

app.put('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const p = validarProduto(req.body);
  const { rows } = await pool.query(
    `UPDATE produtos SET nome = $1, categoria = $2, preco = $3, estoque = $4
      WHERE id = $5 AND ativo = TRUE
      RETURNING id, nome, categoria, preco, estoque`,
    [p.nome, p.categoria, p.preco, p.estoque, id]
  );
  if (!rows.length) throw new ErroHttp(404, 'Produto não encontrado');
  res.json(rows[0]);
});

// Exclusão lógica: o produto some do catálogo, mas o histórico de vendas é preservado
app.delete('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rowCount } = await pool.query(
    'UPDATE produtos SET ativo = FALSE WHERE id = $1 AND ativo = TRUE',
    [id]
  );
  if (!rowCount) throw new ErroHttp(404, 'Produto não encontrado');
  res.status(204).end();
});

// ---------------------------------------------------------
// Clientes
// ---------------------------------------------------------
app.get('/clientes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.nome, c.email, c.telefone,
            COUNT(v.id) FILTER (WHERE v.status = 'concluida')               AS compras,
            COALESCE(SUM(v.total) FILTER (WHERE v.status = 'concluida'), 0) AS total_gasto
       FROM clientes c
       LEFT JOIN vendas v ON v.cliente_id = c.id
      GROUP BY c.id
      ORDER BY c.nome`
  );
  res.json(rows);
});

app.post('/clientes', async (req, res) => {
  const c = validarCliente(req.body);
  const { rows } = await pool.query(
    `INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3)
     RETURNING id, nome, email, telefone`,
    [c.nome, c.email, c.telefone]
  );
  res.status(201).json(rows[0]);
});

app.put('/clientes/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const c = validarCliente(req.body);
  const { rows } = await pool.query(
    `UPDATE clientes SET nome = $1, email = $2, telefone = $3 WHERE id = $4
     RETURNING id, nome, email, telefone`,
    [c.nome, c.email, c.telefone, id]
  );
  if (!rows.length) throw new ErroHttp(404, 'Cliente não encontrado');
  res.json(rows[0]);
});

app.delete('/clientes/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rowCount } = await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
  if (!rowCount) throw new ErroHttp(404, 'Cliente não encontrado');
  res.status(204).end();
});

// ---------------------------------------------------------
// Vendas
// ---------------------------------------------------------
app.get('/vendas', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.total, v.forma_pagamento, v.status, v.criado_em,
            v.cliente_id, COALESCE(c.nome, 'Consumidor final') AS cliente,
            COALESCE(SUM(i.quantidade), 0) AS itens
       FROM vendas v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN itens_venda i ON i.venda_id = v.id
      GROUP BY v.id, c.nome
      ORDER BY v.criado_em DESC
      LIMIT 200`
  );
  res.json(rows);
});

app.get('/vendas/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const venda = await pool.query(
    `SELECT v.id, v.total, v.forma_pagamento, v.status, v.criado_em,
            v.cliente_id, COALESCE(c.nome, 'Consumidor final') AS cliente
       FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = $1`,
    [id]
  );
  if (!venda.rows.length) throw new ErroHttp(404, 'Venda não encontrada');
  const itens = await pool.query(
    `SELECT i.produto_id, p.nome, i.quantidade, i.preco_unitario, i.subtotal
       FROM itens_venda i JOIN produtos p ON p.id = i.produto_id
      WHERE i.venda_id = $1
      ORDER BY i.id`,
    [id]
  );
  res.json({ ...venda.rows[0], itens: itens.rows });
});

// Registrar venda: tudo numa TRANSAÇÃO (ou grava tudo, ou nada)
app.post('/vendas', async (req, res) => {
  const { cliente_id, forma_pagamento = 'pix', itens } = req.body || {};

  if (!Array.isArray(itens) || itens.length === 0) {
    throw new ErroHttp(400, 'A venda precisa ter ao menos um item');
  }
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento)) {
    throw new ErroHttp(400, 'Forma de pagamento inválida');
  }

  // Junta itens repetidos do mesmo produto
  const quantidades = new Map();
  for (const item of itens) {
    const pid = inteiroPositivo(item.produto_id, 'produto_id');
    const qtd = inteiroPositivo(item.quantidade, 'quantidade');
    quantidades.set(pid, (quantidades.get(pid) || 0) + qtd);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (cliente_id) {
      const c = await client.query('SELECT id FROM clientes WHERE id = $1', [cliente_id]);
      if (!c.rows.length) throw new ErroHttp(400, 'Cliente não encontrado');
    }

    // FOR UPDATE trava as linhas: duas vendas simultâneas não vendem o mesmo estoque
    const ids = [...quantidades.keys()];
    const { rows: produtos } = await client.query(
      `SELECT id, nome, preco, estoque FROM produtos
        WHERE id = ANY($1::int[]) AND ativo = TRUE
        ORDER BY id
        FOR UPDATE`,
      [ids]
    );

    const porId = new Map(produtos.map(p => [p.id, p]));
    let total = 0;
    const linhas = [];
    for (const [pid, qtd] of quantidades) {
      const p = porId.get(pid);
      if (!p) throw new ErroHttp(400, `Produto ${pid} não encontrado`);
      if (p.estoque < qtd) {
        throw new ErroHttp(409, `Estoque insuficiente para "${p.nome}" (disponível: ${p.estoque})`);
      }
      const subtotal = Math.round(p.preco * qtd * 100) / 100;
      total += subtotal;
      linhas.push({ pid, qtd, preco: p.preco, subtotal });
    }
    total = Math.round(total * 100) / 100;

    const { rows: [venda] } = await client.query(
      `INSERT INTO vendas (cliente_id, total, forma_pagamento)
       VALUES ($1, $2, $3) RETURNING id, total, forma_pagamento, status, criado_em`,
      [cliente_id || null, total, forma_pagamento]
    );

    for (const l of linhas) {
      await client.query(
        `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [venda.id, l.pid, l.qtd, l.preco, l.subtotal]
      );
      await client.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [l.qtd, l.pid]);
    }

    await client.query('COMMIT');
    res.status(201).json(venda);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Cancelar venda = COMPENSAÇÃO: devolve os itens ao estoque
app.post('/vendas/:id/cancelar', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT status FROM vendas WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new ErroHttp(404, 'Venda não encontrada');
    if (rows[0].status === 'cancelada') throw new ErroHttp(409, 'Venda já está cancelada');

    await client.query(
      `UPDATE produtos p SET estoque = p.estoque + i.quantidade
         FROM itens_venda i
        WHERE i.venda_id = $1 AND i.produto_id = p.id`,
      [id]
    );
    await client.query(`UPDATE vendas SET status = 'cancelada' WHERE id = $1`, [id]);
    await client.query('COMMIT');
    res.json({ id, status: 'cancelada' });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------
// Painel (dashboard)
// ---------------------------------------------------------
app.get('/dashboard', async (req, res) => {
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
      `SELECT p.id, p.nome, SUM(i.quantidade) AS quantidade, SUM(i.subtotal) AS total
         FROM itens_venda i
         JOIN vendas v   ON v.id = i.venda_id AND v.status = 'concluida'
         JOIN produtos p ON p.id = i.produto_id
        GROUP BY p.id, p.nome
        ORDER BY total DESC
        LIMIT 5`
    ),
    pool.query(
      `SELECT id, nome, estoque FROM produtos
        WHERE ativo = TRUE AND estoque <= 5 ORDER BY estoque, nome`
    ),
  ]);

  res.json({
    faturamento: resumo.rows[0].faturamento,
    vendas: resumo.rows[0].vendas,
    ticket_medio: resumo.rows[0].ticket_medio,
    hoje: hoje.rows[0],
    por_dia: porDia.rows,
    top_produtos: top.rows,
    estoque_baixo: baixo.rows,
  });
});

// ---------------------------------------------------------
// Rota inexistente e tratamento de erros
// ---------------------------------------------------------
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

app.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor' });
});

// ---------------------------------------------------------
// Inicialização: espera o banco ficar pronto (resiliência)
// ---------------------------------------------------------
async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Conectado ao banco de dados');
      return;
    } catch (e) {
      console.log(`Banco indisponível (tentativa ${i}/${tentativas}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Não foi possível conectar ao banco');
}

aguardarBanco()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`API de vendas executando na porta ${PORT}`)))
  .catch(err => { console.error(err.message); process.exit(1); });
