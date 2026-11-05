// =========================================================
// Microsserviço de CLIENTES  (contêiner "clientes")
// Dono do cadastro de clientes. Único que acessa o clientes_db.
// Conversa com: vendas (para saber compras e total gasto).
// =========================================================
const express = require('express');
const { Pool, types } = require('pg');

types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));

const SERVICO = 'clientes';
const PORT = Number(process.env.PORT || 3000);
const VENDAS_URL = process.env.VENDAS_URL || 'http://vendas:3000';

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'clientes_user',
  password: process.env.DB_PASSWORD || 'clientes123',
  database: process.env.DB_NAME || 'clientes_db',
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

function validarCliente(body) {
  const nome = String(body.nome || '').trim();
  if (!nome) throw new ErroHttp(400, 'Nome do cliente é obrigatório');
  return {
    nome,
    email: String(body.email || '').trim() || null,
    telefone: String(body.telefone || '').trim() || null,
  };
}

// Chamada HTTP a outro microsserviço, com tempo limite
async function chamarServico(nome, url) {
  const inicio = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    console.log(`[${SERVICO}] -> ${nome}: GET ${new URL(url).pathname} ${res.status} (${Date.now() - inicio}ms)`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (e) {
    console.log(`[${SERVICO}] -> ${nome} indisponível: ${e.message}`);
    return null;
  }
}

const CAMPOS = 'id, nome, email, telefone';

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ servico: SERVICO, status: 'ok', banco: 'ok' });
  } catch (e) {
    res.status(503).json({ servico: SERVICO, status: 'ok', banco: 'indisponível' });
  }
});

// Lista com as estatísticas de compra vindas do serviço de VENDAS.
// Se vendas estiver fora do ar, a lista continua funcionando (sem os números).
app.get('/clientes', async (req, res) => {
  const [{ rows }, resumo] = await Promise.all([
    pool.query(`SELECT ${CAMPOS} FROM clientes ORDER BY nome`),
    chamarServico('vendas', `${VENDAS_URL}/vendas/resumo-clientes`),
  ]);
  const porCliente = new Map((resumo || []).map(r => [r.cliente_id, r]));
  res.json(rows.map(c => ({
    ...c,
    compras: resumo ? (porCliente.get(c.id)?.compras ?? 0) : null,
    total_gasto: resumo ? (porCliente.get(c.id)?.total_gasto ?? 0) : null,
  })));
});

// Usado pelo serviço de vendas para validar o cliente de uma venda
app.get('/clientes/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rows } = await pool.query(`SELECT ${CAMPOS} FROM clientes WHERE id = $1`, [id]);
  if (!rows.length) throw new ErroHttp(404, 'Cliente não encontrado');
  res.json(rows[0]);
});

app.post('/clientes', async (req, res) => {
  const c = validarCliente(req.body);
  const { rows } = await pool.query(
    `INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3) RETURNING ${CAMPOS}`,
    [c.nome, c.email, c.telefone]
  );
  res.status(201).json(rows[0]);
});

app.put('/clientes/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const c = validarCliente(req.body);
  const { rows } = await pool.query(
    `UPDATE clientes SET nome = $1, email = $2, telefone = $3 WHERE id = $4 RETURNING ${CAMPOS}`,
    [c.nome, c.email, c.telefone, id]
  );
  if (!rows.length) throw new ErroHttp(404, 'Cliente não encontrado');
  res.json(rows[0]);
});

// As vendas antigas guardam o nome do cliente, então o histórico não se perde
app.delete('/clientes/:id', async (req, res) => {
  const id = inteiroPositivo(req.params.id, 'id');
  const { rowCount } = await pool.query('DELETE FROM clientes WHERE id = $1', [id]);
  if (!rowCount) throw new ErroHttp(404, 'Cliente não encontrado');
  res.status(204).end();
});

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
app.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error(`[${SERVICO}]`, err);
  res.status(500).json({ erro: 'Erro interno no serviço de clientes' });
});

async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('SELECT 1');
      console.log(`[${SERVICO}] Conectado ao banco clientes_db`);
      return;
    } catch (e) {
      console.log(`[${SERVICO}] Banco indisponível (tentativa ${i}/${tentativas}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Não foi possível conectar ao banco');
}

aguardarBanco()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`[${SERVICO}] Microsserviço de clientes na porta ${PORT}`)))
  .catch(err => { console.error(err.message); process.exit(1); });
