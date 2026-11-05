// =========================================================
// Front-end do Sistema de Vendas
// Fala SOMENTE com /api — o Nginx repassa para o contêiner "api"
// =========================================================
const API = '/api';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGAMENTOS = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito' };
const CORES = ['#2a52be', '#f26a1b', '#1f9d6b', '#8a4fd8', '#d64545', '#0e8fa8', '#c98a0b', '#4b5563'];

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  let dados = null;
  try { dados = await res.json(); } catch { /* resposta sem JSON */ }
  if (!res.ok) throw new Error(dados?.erro || `Erro ${res.status} ao acessar a API`);
  return dados;
}

function toast(msg, erro = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (erro ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------
// Modal
// ---------------------------------------------------------
function abrirModal(titulo, corpoHtml, botoes = []) {
  $('#modal-title').textContent = titulo;
  $('#modal-body').innerHTML = corpoHtml;
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  for (const b of botoes) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.classe || '');
    btn.textContent = b.texto;
    btn.onclick = b.acao;
    foot.appendChild(btn);
  }
  foot.style.display = botoes.length ? 'flex' : 'none';
  $('#modal-bg').classList.add('open');
  const primeiro = $('#modal-body input');
  if (primeiro) primeiro.focus();
}
function fecharModal() { $('#modal-bg').classList.remove('open'); }
$('#modal-x').onclick = fecharModal;
$('#modal-bg').addEventListener('click', e => { if (e.target.id === 'modal-bg') fecharModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

// ---------------------------------------------------------
// Navegação
// ---------------------------------------------------------
const VIEWS = {
  painel:      { titulo: 'Painel',      sub: 'Visão geral das vendas',                 carregar: carregarPainel },
  pdv:         { titulo: 'Nova venda',  sub: 'Monte o carrinho e finalize a venda',    carregar: carregarPdv },
  vendas:      { titulo: 'Vendas',      sub: 'Histórico — clique numa venda para ver os detalhes', carregar: carregarVendas },
  produtos:    { titulo: 'Produtos',    sub: 'Catálogo e controle de estoque',         carregar: carregarProdutos },
  clientes:    { titulo: 'Clientes',    sub: 'Cadastro de clientes',                   carregar: carregarClientes },
  arquitetura: { titulo: 'Arquitetura', sub: 'Como os contêineres se comunicam',       carregar: verificarSaude },
};

function irPara(nome) {
  const v = VIEWS[nome] || VIEWS.painel;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === nome));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + nome));
  $('#page-title').textContent = v.titulo;
  $('#page-sub').textContent = v.sub;
  location.hash = nome;
  v.carregar().catch(e => toast(e.message, true));
}
$$('#nav button').forEach(b => (b.onclick = () => irPara(b.dataset.view)));

// ---------------------------------------------------------
// Saúde dos contêineres
// ---------------------------------------------------------
const SERVICOS = ['produtos', 'clientes', 'vendas'];

// Pergunta a saúde de um microsserviço (via gateway). Retorna {ok, banco, ms}.
async function saudeDe(servico) {
  const inicio = performance.now();
  try {
    const res = await fetch(`${API}/health/${servico}`, { cache: 'no-store' });
    const h = await res.json().catch(() => ({}));
    return { ok: h.servico === servico, banco: h.banco === 'ok', ms: Math.round(performance.now() - inicio) };
  } catch {
    return { ok: false, banco: false, ms: null };
  }
}

async function verificarSaude() {
  const resultados = await Promise.all(SERVICOS.map(saudeDe));
  const saude = Object.fromEntries(SERVICOS.map((s, i) => [s, resultados[i]]));
  const dbOk = resultados.some(r => r.banco);
  const fora = SERVICOS.filter(s => !saude[s].ok);

  const tudoOk = fora.length === 0 && dbOk;
  $('#status-dot').className = 'dot ' + (tudoOk ? 'ok' : 'bad');
  $('#status-text').textContent = tudoOk ? 'Todos os serviços online'
    : !dbOk && fora.length === 0 ? 'Banco indisponível'
    : fora.length === 1 ? `Serviço de ${fora[0]} indisponível`
    : `${fora.length} serviços indisponíveis`;

  const ponto = (id, ok) => { const el = $(id); el.textContent = ok ? '●' : '○'; el.style.color = ok ? '#4ade80' : '#f87171'; };
  ponto('#sf-web', true);
  SERVICOS.forEach(s => ponto('#sf-' + s, saude[s].ok));
  ponto('#sf-db', dbOk);

  const marca = (el, ok) => { el.textContent = ok ? 'online' : 'offline'; el.className = 'badge ' + (ok ? 'b-ok' : 'b-bad'); };
  SERVICOS.forEach(s => marca($('#arch-' + s), saude[s].ok));
  marca($('#arch-db'), dbOk);

  const tempos = SERVICOS.filter(s => saude[s].ok).map(s => `${s} ${saude[s].ms} ms`).join(' · ');
  $('#arch-lat').innerHTML = `<strong>Última verificação:</strong> ${new Date().toLocaleTimeString('pt-BR')}` +
    (tempos ? ` — ida e volta até cada serviço: ${tempos}.` : '.') +
    (fora.length ? ` <strong>Fora do ar:</strong> ${fora.join(', ')}. Veja com <code>docker compose ps</code>.` : '');
}
$('#arch-refresh').onclick = () => verificarSaude().then(() => toast('Status atualizado'));

// ---------------------------------------------------------
// Painel
// ---------------------------------------------------------
async function carregarPainel() {
  const d = await api('/dashboard');
  $('#k-fat').textContent = brl(d.faturamento);
  $('#k-vendas').textContent = d.vendas;
  $('#k-ticket').textContent = brl(d.ticket_medio);
  $('#k-hoje').textContent = d.hoje.vendas;
  $('#k-hoje-sub').textContent = brl(d.hoje.faturamento) + ' faturados hoje';

  desenharGrafico(d.por_dia);

  $('#top-list').innerHTML = d.top_produtos.length
    ? d.top_produtos.map((p, i) => `
        <li><span class="rank">${i + 1}</span>
          <div class="grow"><div class="title">${esc(p.nome)}</div><div class="meta">${p.quantidade} un. vendidas</div></div>
          <strong class="num">${brl(p.total)}</strong></li>`).join('')
    : '<li class="empty">Nenhuma venda ainda</li>';

  $('#low-list').innerHTML = !d.estoque_disponivel
    ? '<li class="empty">Serviço de produtos indisponível</li>'
    : d.estoque_baixo.length
    ? d.estoque_baixo.map(p => `
        <li><div class="grow"><div class="title">${esc(p.nome)}</div><div class="meta">#${p.id}</div></div>
          <span class="badge ${p.estoque === 0 ? 'b-bad' : 'b-warn'}">${p.estoque} un.</span></li>`).join('')
    : '<li class="empty">Todos os produtos com estoque ok</li>';
}

function desenharGrafico(dias) {
  const W = 640, H = 240, pad = { t: 22, r: 8, b: 28, l: 52 };
  const max = Math.max(...dias.map(d => d.total), 100);
  const topo = Math.ceil(max / 500) * 500;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / dias.length;
  const hoje = dias.length - 1;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Faturamento dos últimos 7 dias">`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ih - (ih * i) / 4;
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>`;
    svg += `<text class="axis" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${((topo * i) / 4).toLocaleString('pt-BR')}</text>`;
  }
  dias.forEach((d, i) => {
    const h = (d.total / topo) * ih;
    const x = pad.l + i * bw + bw * 0.2;
    const y = pad.t + ih - h;
    const [ano, mes, dia] = d.dia.split('-');
    const rotulo = i === hoje ? 'Hoje' : `${dia}/${mes}`;
    svg += `<rect class="bar${i === hoje ? ' today' : ''}" x="${x}" y="${y}" width="${bw * 0.6}" height="${Math.max(h, 0)}" rx="5"><title>${dia}/${mes}/${ano}: ${brl(d.total)}</title></rect>`;
    if (d.total > 0) svg += `<text class="val" x="${x + bw * 0.3}" y="${y - 6}" text-anchor="middle">${Math.round(d.total).toLocaleString('pt-BR')}</text>`;
    svg += `<text class="axis" x="${x + bw * 0.3}" y="${H - 8}" text-anchor="middle">${rotulo}</text>`;
  });
  $('#chart').innerHTML = svg + '</svg>';
}

// ---------------------------------------------------------
// PDV (nova venda)
// ---------------------------------------------------------
const pdv = { produtos: [], categoria: 'Todas', carrinho: new Map(), pagamento: 'pix' };

async function carregarPdv() {
  // Se o serviço de clientes estiver fora, o caixa continua vendendo para "Consumidor final"
  const [produtos, clientes] = await Promise.all([
    api('/produtos'),
    api('/clientes').catch(() => { toast('Serviço de clientes indisponível: vendendo como Consumidor final', true); return []; }),
  ]);
  pdv.produtos = produtos;
  // remove do carrinho o que não existe mais e ajusta ao estoque atual
  for (const [id, qtd] of pdv.carrinho) {
    const p = produtos.find(x => x.id === id);
    if (!p || p.estoque === 0) pdv.carrinho.delete(id);
    else if (qtd > p.estoque) pdv.carrinho.set(id, p.estoque);
  }
  const sel = $('#cart-cliente');
  const atual = sel.value;
  sel.innerHTML = '<option value="">Consumidor final</option>' +
    clientes.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  sel.value = atual;

  const cats = ['Todas', ...new Set(produtos.map(p => p.categoria))];
  if (!cats.includes(pdv.categoria)) pdv.categoria = 'Todas';
  $('#pdv-cats').innerHTML = cats.map(c => `<button class="chip${c === pdv.categoria ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $$('#pdv-cats .chip').forEach(b => (b.onclick = () => { pdv.categoria = b.dataset.cat; carregarPdvGrid(); $$('#pdv-cats .chip').forEach(x => x.classList.toggle('active', x === b)); }));

  carregarPdvGrid();
  renderCarrinho();
}

function iniciais(nome) {
  return nome.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function carregarPdvGrid() {
  const termo = $('#pdv-busca').value.trim().toLowerCase();
  const lista = pdv.produtos.filter(p =>
    (pdv.categoria === 'Todas' || p.categoria === pdv.categoria) &&
    (!termo || p.nome.toLowerCase().includes(termo)));

  $('#pdv-produtos').innerHTML = lista.length ? lista.map(p => {
    const noCarrinho = pdv.carrinho.get(p.id) || 0;
    const restante = p.estoque - noCarrinho;
    return `
      <button class="product" data-id="${p.id}" ${restante <= 0 ? 'disabled' : ''}>
        <div class="thumb" style="background:${CORES[p.id % CORES.length]}">${esc(iniciais(p.nome))}</div>
        <div class="pname">${esc(p.nome)}</div>
        <span class="tag" style="align-self:flex-start">${esc(p.categoria)}</span>
        <div class="prow"><span class="price num">${brl(p.preco)}</span>
          <span class="stock">${restante <= 0 ? 'Esgotado' : restante + ' disp.'}</span></div>
      </button>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">Nenhum produto encontrado</div>';

  $$('#pdv-produtos .product').forEach(b => (b.onclick = () => alterarQtd(Number(b.dataset.id), +1)));
}
$('#pdv-busca').addEventListener('input', carregarPdvGrid);

function alterarQtd(id, delta) {
  const p = pdv.produtos.find(x => x.id === id);
  if (!p) return;
  const nova = (pdv.carrinho.get(id) || 0) + delta;
  if (nova > p.estoque) return toast(`Só há ${p.estoque} un. de ${p.nome} em estoque`, true);
  if (nova <= 0) pdv.carrinho.delete(id); else pdv.carrinho.set(id, nova);
  renderCarrinho();
  carregarPdvGrid();
}

function renderCarrinho() {
  const ul = $('#cart-items');
  let total = 0;
  if (!pdv.carrinho.size) {
    ul.innerHTML = `<li class="cart-empty"><svg><use href="#i-cart"/></svg><div>Carrinho vazio</div><div style="font-size:12px">Clique em um produto para adicionar</div></li>`;
  } else {
    ul.innerHTML = [...pdv.carrinho].map(([id, qtd]) => {
      const p = pdv.produtos.find(x => x.id === id);
      const sub = p.preco * qtd;
      total += sub;
      return `<li class="cart-item">
          <div><div class="cname">${esc(p.nome)}</div><div class="cprice num">${brl(p.preco)} / un.</div></div>
          <div class="csub num">${brl(sub)}</div>
          <div class="qty"><button data-id="${id}" data-d="-1" aria-label="Diminuir">−</button><span class="num">${qtd}</span><button data-id="${id}" data-d="1" aria-label="Aumentar">+</button></div>
        </li>`;
    }).join('');
    $$('#cart-items .qty button').forEach(b => (b.onclick = () => alterarQtd(Number(b.dataset.id), Number(b.dataset.d))));
  }
  $('#cart-total').textContent = brl(total);
  $('#cart-finish').disabled = !pdv.carrinho.size;
}

$$('#cart-pay button').forEach(b => (b.onclick = () => {
  pdv.pagamento = b.dataset.pay;
  $$('#cart-pay button').forEach(x => x.classList.toggle('active', x === b));
}));
$('#cart-clear').onclick = () => { pdv.carrinho.clear(); renderCarrinho(); carregarPdvGrid(); };

$('#cart-finish').onclick = async () => {
  const btn = $('#cart-finish');
  btn.disabled = true;
  btn.textContent = 'Registrando…';
  try {
    const venda = await api('/vendas', {
      method: 'POST',
      body: {
        cliente_id: Number($('#cart-cliente').value) || null,
        forma_pagamento: pdv.pagamento,
        itens: [...pdv.carrinho].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
      },
    });
    pdv.carrinho.clear();
    toast(`Venda #${venda.id} registrada — ${brl(venda.total)}`);
    await carregarPdv();
    mostrarVenda(venda.id);
  } catch (e) {
    toast(e.message, true);
    await carregarPdv(); // atualiza o estoque caso outra venda tenha consumido
  } finally {
    btn.textContent = 'Finalizar venda';
    btn.disabled = !pdv.carrinho.size;
  }
};

// ---------------------------------------------------------
// Vendas
// ---------------------------------------------------------
let vendasCache = [];
let vendasFiltro = 'todas';

async function carregarVendas() {
  vendasCache = await api('/vendas');
  renderVendas();
}
function renderVendas() {
  const lista = vendasCache.filter(v => vendasFiltro === 'todas' || v.status === vendasFiltro);
  $('#vendas-body').innerHTML = lista.length ? lista.map(v => `
    <tr class="clickable" data-id="${v.id}">
      <td><strong>#${v.id}</strong></td>
      <td>${dataHora(v.criado_em)}</td>
      <td>${esc(v.cliente)}</td>
      <td class="right num">${v.itens}</td>
      <td>${PAGAMENTOS[v.forma_pagamento]}</td>
      <td>${v.status === 'concluida' ? '<span class="badge b-ok">Concluída</span>' : '<span class="badge b-bad">Cancelada</span>'}</td>
      <td class="right num"><strong>${brl(v.total)}</strong></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhuma venda</td></tr>';
  $$('#vendas-body tr.clickable').forEach(tr => (tr.onclick = () => mostrarVenda(Number(tr.dataset.id))));
}
$$('#vendas-filtro .chip').forEach(b => (b.onclick = () => {
  vendasFiltro = b.dataset.f;
  $$('#vendas-filtro .chip').forEach(x => x.classList.toggle('active', x === b));
  renderVendas();
}));
$('#vendas-refresh').onclick = () => carregarVendas().catch(e => toast(e.message, true));

async function mostrarVenda(id) {
  try {
    const v = await api('/vendas/' + id);
    const itens = v.itens.map(i => `
      <li><div class="grow"><div class="title">${esc(i.nome)}</div><div class="meta">${i.quantidade} × ${brl(i.preco_unitario)}</div></div>
        <strong class="num">${brl(i.subtotal)}</strong></li>`).join('');
    const corpo = `
      <dl class="kv">
        <dt>Data</dt><dd>${dataHora(v.criado_em)}</dd>
        <dt>Cliente</dt><dd>${esc(v.cliente)}</dd>
        <dt>Pagamento</dt><dd>${PAGAMENTOS[v.forma_pagamento]}</dd>
        <dt>Status</dt><dd>${v.status === 'concluida' ? '<span class="badge b-ok">Concluída</span>' : '<span class="badge b-bad">Cancelada</span>'}</dd>
      </dl>
      <ul class="list" style="border:1px solid var(--border);border-radius:10px">${itens}</ul>
      <div class="receipt-total"><span>Total</span><span class="num">${brl(v.total)}</span></div>`;
    const botoes = [{ texto: 'Fechar', acao: fecharModal }];
    if (v.status === 'concluida') {
      botoes.unshift({ texto: 'Cancelar venda', classe: 'btn-danger', acao: () => cancelarVenda(v.id) });
    }
    abrirModal(`Venda #${v.id}`, corpo, botoes);
  } catch (e) { toast(e.message, true); }
}

async function cancelarVenda(id) {
  if (!confirm(`Cancelar a venda #${id}? Os itens voltam para o estoque.`)) return;
  try {
    await api(`/vendas/${id}/cancelar`, { method: 'POST' });
    fecharModal();
    toast(`Venda #${id} cancelada e estoque devolvido`);
    const atual = location.hash.slice(1);
    if (VIEWS[atual]) VIEWS[atual].carregar();
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------
// Produtos
// ---------------------------------------------------------
let produtosCache = [];

async function carregarProdutos() {
  produtosCache = await api('/produtos');
  renderProdutos();
}
function renderProdutos() {
  const termo = $('#prod-busca').value.trim().toLowerCase();
  const lista = produtosCache.filter(p => !termo || p.nome.toLowerCase().includes(termo) || p.categoria.toLowerCase().includes(termo));
  $('#prod-body').innerHTML = lista.length ? lista.map(p => {
    const badge = p.estoque === 0 ? 'b-bad' : p.estoque <= 5 ? 'b-warn' : 'b-ok';
    return `<tr>
      <td class="num">${p.id}</td>
      <td><strong>${esc(p.nome)}</strong></td>
      <td><span class="tag">${esc(p.categoria)}</span></td>
      <td class="right num">${brl(p.preco)}</td>
      <td class="right"><span class="badge ${badge}">${p.estoque} un.</span></td>
      <td class="right"><span class="actions">
        <button class="btn icon-btn" data-edit="${p.id}" title="Editar"><svg><use href="#i-edit"/></svg></button>
        <button class="btn icon-btn btn-danger" data-del="${p.id}" title="Excluir"><svg><use href="#i-trash"/></svg></button>
      </span></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">Nenhum produto</td></tr>';

  $$('#prod-body [data-edit]').forEach(b => (b.onclick = () => formProduto(produtosCache.find(p => p.id === Number(b.dataset.edit)))));
  $$('#prod-body [data-del]').forEach(b => (b.onclick = () => excluirProduto(produtosCache.find(p => p.id === Number(b.dataset.del)))));
}
$('#prod-busca').addEventListener('input', renderProdutos);
$('#prod-novo').onclick = () => formProduto();

function formProduto(p = null) {
  const cats = [...new Set(produtosCache.map(x => x.categoria))];
  abrirModal(p ? `Editar produto #${p.id}` : 'Novo produto', `
    <form class="form-grid" id="f-prod" autocomplete="off">
      <div class="field full"><label>Nome</label><input class="input" name="nome" required maxlength="120" value="${esc(p?.nome)}"></div>
      <div class="field full"><label>Categoria</label><input class="input" name="categoria" list="dl-cats" maxlength="60" value="${esc(p?.categoria || '')}" placeholder="Ex.: Periféricos">
        <datalist id="dl-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Preço (R$)</label><input class="input" name="preco" type="number" step="0.01" min="0" required value="${p?.preco ?? ''}"></div>
      <div class="field"><label>Estoque</label><input class="input" name="estoque" type="number" step="1" min="0" required value="${p?.estoque ?? 0}"></div>
    </form>`, [
    { texto: 'Cancelar', acao: fecharModal },
    { texto: p ? 'Salvar alterações' : 'Cadastrar', classe: 'btn-primary', acao: () => salvarProduto(p) },
  ]);
  $('#f-prod').onsubmit = e => { e.preventDefault(); salvarProduto(p); };
}

async function salvarProduto(p) {
  const f = $('#f-prod');
  if (!f.reportValidity()) return;
  const body = {
    nome: f.nome.value, categoria: f.categoria.value,
    preco: Number(f.preco.value), estoque: Number(f.estoque.value),
  };
  try {
    const r = p ? await api('/produtos/' + p.id, { method: 'PUT', body })
                : await api('/produtos', { method: 'POST', body });
    fecharModal();
    toast(p ? 'Produto atualizado' : `Produto #${r.id} cadastrado`);
    carregarProdutos();
  } catch (e) { toast(e.message, true); }
}

async function excluirProduto(p) {
  if (!confirm(`Excluir "${p.nome}" do catálogo? As vendas antigas continuam no histórico.`)) return;
  try {
    await api('/produtos/' + p.id, { method: 'DELETE' });
    toast('Produto excluído');
    carregarProdutos();
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------
// Clientes
// ---------------------------------------------------------
let clientesCache = [];

async function carregarClientes() {
  clientesCache = await api('/clientes');
  renderClientes();
}
function renderClientes() {
  const termo = $('#cli-busca').value.trim().toLowerCase();
  const lista = clientesCache.filter(c => !termo || c.nome.toLowerCase().includes(termo) || (c.email || '').toLowerCase().includes(termo));
  $('#cli-body').innerHTML = lista.length ? lista.map(c => `<tr>
      <td><strong>${esc(c.nome)}</strong></td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.telefone || '—')}</td>
      <td class="right num">${c.compras ?? '—'}</td>
      <td class="right num">${c.total_gasto === null ? '<span title="Serviço de vendas indisponível">—</span>' : brl(c.total_gasto)}</td>
      <td class="right"><span class="actions">
        <button class="btn icon-btn" data-edit="${c.id}" title="Editar"><svg><use href="#i-edit"/></svg></button>
        <button class="btn icon-btn btn-danger" data-del="${c.id}" title="Excluir"><svg><use href="#i-trash"/></svg></button>
      </span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum cliente</td></tr>';

  $$('#cli-body [data-edit]').forEach(b => (b.onclick = () => formCliente(clientesCache.find(c => c.id === Number(b.dataset.edit)))));
  $$('#cli-body [data-del]').forEach(b => (b.onclick = () => excluirCliente(clientesCache.find(c => c.id === Number(b.dataset.del)))));
}
$('#cli-busca').addEventListener('input', renderClientes);
$('#cli-novo').onclick = () => formCliente();

function formCliente(c = null) {
  abrirModal(c ? 'Editar cliente' : 'Novo cliente', `
    <form class="form-grid" id="f-cli" autocomplete="off">
      <div class="field full"><label>Nome</label><input class="input" name="nome" required maxlength="120" value="${esc(c?.nome)}"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" maxlength="120" value="${esc(c?.email || '')}"></div>
      <div class="field"><label>Telefone</label><input class="input" name="telefone" maxlength="30" value="${esc(c?.telefone || '')}" placeholder="(47) 99999-9999"></div>
    </form>`, [
    { texto: 'Cancelar', acao: fecharModal },
    { texto: c ? 'Salvar alterações' : 'Cadastrar', classe: 'btn-primary', acao: () => salvarCliente(c) },
  ]);
  $('#f-cli').onsubmit = e => { e.preventDefault(); salvarCliente(c); };
}

async function salvarCliente(c) {
  const f = $('#f-cli');
  if (!f.reportValidity()) return;
  const body = { nome: f.nome.value, email: f.email.value, telefone: f.telefone.value };
  try {
    c ? await api('/clientes/' + c.id, { method: 'PUT', body })
      : await api('/clientes', { method: 'POST', body });
    fecharModal();
    toast(c ? 'Cliente atualizado' : 'Cliente cadastrado');
    carregarClientes();
  } catch (e) { toast(e.message, true); }
}

async function excluirCliente(c) {
  if (!confirm(`Excluir o cliente "${c.nome}"? As vendas antigas continuam no histórico com o nome dele.`)) return;
  try {
    await api('/clientes/' + c.id, { method: 'DELETE' });
    toast('Cliente excluído');
    carregarClientes();
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------
// Inicialização
// ---------------------------------------------------------
verificarSaude();
setInterval(verificarSaude, 15000);
irPara(location.hash.slice(1) || 'painel');
