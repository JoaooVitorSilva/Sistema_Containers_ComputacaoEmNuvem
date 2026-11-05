// =========================================================
// Microsserviço de PRODUTOS  (contêiner "produtos")
// Dono do catálogo e do ESTOQUE. Único que acessa o produtos_db.
// =========================================================
const express = require('express');
const { Pool, types } = require('pg');

types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // NUMERIC
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10))); // BIGINT

const SERVICO = 'produtos';
const PORT = Number(process.env.PORT || 3000);

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'produtos_user',
  password: process.env.DB_PASSWORD || 'produtos123',
  database: process.env.DB_NAME || 'produtos_db',
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

// Soma as quantidades por produto: [{produto_id, quantidade}] -> Map
function agruparItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroHttp(400, 'Informe ao menos um item');
  const mapa = new Map();
  for (const item of itens) {
    const pid = inteiroPositivo(item.produto_id, 'produto_id');
    const qtd = inteiroPositivo(item.quantidade, 'quantidade');
    mapa.set(pid, (mapa.get(pid) || 0) + qtd);
  }
  return mapa;
}

const CAMPOS = 'id, nome, categoria, preco, estoque';

// ---------------------------------------------------------
// Saúde
// ---------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servico: SERVICO, status: 'ok', banco: 'ok' });
  } catch (e) {
    res.status(503).json({ servico: SERVICO, status: 'ok', banco: 'indisponível' });
  }
});

// ---------------------------------------------------------
// API pública (acessada pelo front via gateway)
// ---------------------------------------------------------
app.get('/produtos', async (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM produtos
      WHERE ativo = TRUE
        AND ($1 = '' OR nome ILIKE '%' || $1 || '%' OR categoria ILIKE '%' || $1 || '%')
      ORDER BY id`,
    [busca]
  );
  res.json(rows);
});

app.get('/produtos/estoque-baixo', async (req, res) => {
  const limite = Number(req.query.limite ?? 5);
  const { rows } = await pool.query(
    `SELECT id, nome, estoque FROM produtos
      WHERE ativo = TRUE AND estoque <= $1 ORDER BY estoque, nome`,
    [Number.isFinite(limite) ? limite : 5]
  );
  res.json(rows);
});

app.get('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rows } = await pool.query(`SELECT ${CAMPOS} FROM produtos WHERE id = $1 AND ativo = TRUE`, [id]);
  if (!rows.length) throw new ErroHttp(404, 'Produto não encontrado');
  res.json(rows[0]);
});

app.post('/produtos', async (req, res) => {
  const p = validarProduto(req.body);
  const { rows } = await pool.query(
    `INSERT INTO produtos (nome, categoria, preco, estoque) VALUES ($1, $2, $3, $4) RETURNING ${CAMPOS}`,
    [p.nome, p.categoria, p.preco, p.estoque]
  );
  res.status(201).json(rows[0]);
});

app.put('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const p = validarProduto(req.body);
  const { rows } = await pool.query(
    `UPDATE produtos SET nome = $1, categoria = $2, preco = $3, estoque = $4
      WHERE id = $5 AND ativo = TRUE RETURNING ${CAMPOS}`,
    [p.nome, p.categoria, p.preco, p.estoque, id]
  );
  if (!rows.length) throw new ErroHttp(404, 'Produto não encontrado');
  res.json(rows[0]);
});

// Exclusão lógica: some do catálogo, mas o estoque ainda pode ser devolvido
app.delete('/produtos/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rowCount } = await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1 AND ativo = TRUE', [id]);
  if (!rowCount) throw new ErroHttp(404, 'Produto não encontrado');
  res.status(204).end();
});

// ---------------------------------------------------------
// API interna (chamada SÓ pelo serviço de vendas, pela rede interna;
// o gateway bloqueia essas rotas para o navegador)
// ---------------------------------------------------------

// Reserva = confere e baixa o estoque numa transação. Tudo ou nada.
app.post('/produtos/reservar', async (req, res) => {
  const quantidades = agruparItens(req.body?.itens);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE trava as linhas: duas vendas simultâneas não levam a mesma unidade
    const { rows } = await client.query(
      `SELECT id, nome, preco, estoque FROM produtos
        WHERE id = ANY($1::int[]) AND ativo = TRUE
        ORDER BY id FOR UPDATE`,
      [[...quantidades.keys()]]
    );
    const porId = new Map(rows.map(p => [p.id, p]));
    const reservados = [];
    for (const [pid, qtd] of quantidades) {
      const p = porId.get(pid);
      if (!p) throw new ErroHttp(400, `Produto ${pid} não encontrado`);
      if (p.estoque < qtd) throw new ErroHttp(409, `Estoque insuficiente para "${p.nome}" (disponível: ${p.estoque})`);
      reservados.push({ produto_id: pid, nome: p.nome, preco: p.preco, quantidade: qtd });
    }
    for (const r of reservados) {
      await client.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [r.quantidade, r.produto_id]);
    }
    await client.query('COMMIT');
    res.json({ itens: reservados });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Devolução = COMPENSAÇÃO (venda cancelada ou que falhou depois da reserva)
app.post('/produtos/devolver', async (req, res) => {
  const quantidades = agruparItens(req.body?.itens);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [pid, qtd] of quantidades) {
      await client.query('UPDATE produtos SET estoque = estoque + $1 WHERE id = $2', [qtd, pid]);
    }
    await client.query('COMMIT');
    res.json({ devolvido: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
app.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error(`[${SERVICO}]`, err);
  res.status(500).json({ erro: 'Erro interno no serviço de produtos' });
});

async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      console.log(`[${SERVICO}] Conectado ao banco produtos_db`);
      return;
    } catch (e) {
      console.log(`[${SERVICO}] Banco indisponível (tentativa ${i}/${tentativas}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Não foi possível conectar ao banco');
}

aguardarBanco()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`[${SERVICO}] Microsserviço de produtos na porta ${PORT}`)))
  .catch(err => { console.error(err.message); process.exit(1); });
