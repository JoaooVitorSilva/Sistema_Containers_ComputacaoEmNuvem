-- =========================================================
-- Banco de dados do Sistema de Vendas
-- Executado automaticamente pelo contêiner PostgreSQL
-- na PRIMEIRA vez que o volume de dados é criado.
-- =========================================================

CREATE TABLE produtos (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(120)   NOT NULL,
    categoria   VARCHAR(60)    NOT NULL DEFAULT 'Geral',
    preco       NUMERIC(10,2)  NOT NULL CHECK (preco >= 0),
    estoque     INTEGER        NOT NULL DEFAULT 0 CHECK (estoque >= 0),
    ativo       BOOLEAN        NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE clientes (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(120)  NOT NULL,
    email       VARCHAR(120),
    telefone    VARCHAR(30),
    criado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE vendas (
    id               SERIAL PRIMARY KEY,
    cliente_id       INTEGER       REFERENCES clientes(id) ON DELETE SET NULL,
    total            NUMERIC(12,2) NOT NULL DEFAULT 0,
    forma_pagamento  VARCHAR(20)   NOT NULL DEFAULT 'pix'
                     CHECK (forma_pagamento IN ('pix','dinheiro','credito','debito')),
    status           VARCHAR(20)   NOT NULL DEFAULT 'concluida'
                     CHECK (status IN ('concluida','cancelada')),
    criado_em        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE itens_venda (
    id              SERIAL PRIMARY KEY,
    venda_id        INTEGER       NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id      INTEGER       NOT NULL REFERENCES produtos(id),
    quantidade      INTEGER       NOT NULL CHECK (quantidade > 0),
    preco_unitario  NUMERIC(10,2) NOT NULL,
    subtotal        NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_itens_venda_venda   ON itens_venda(venda_id);
CREATE INDEX idx_itens_venda_produto ON itens_venda(produto_id);
CREATE INDEX idx_vendas_data         ON vendas(criado_em);

-- ---------------------------------------------------------
-- Dados iniciais (mesmos ids da atividade anterior: 101+)
-- ---------------------------------------------------------
INSERT INTO produtos (id, nome, categoria, preco, estoque) VALUES
 (101, 'Notebook',            'Computadores', 3500.00, 12),
 (102, 'Mouse',               'Periféricos',    80.00, 30),
 (103, 'Teclado',             'Periféricos',   150.00, 20),
 (104, 'Monitor 24"',         'Monitores',     899.90,  8),
 (105, 'Headset Gamer',       'Áudio',         249.90, 15),
 (106, 'Webcam Full HD',      'Periféricos',   189.00,  4),
 (107, 'SSD 1TB',             'Armazenamento', 459.00, 25),
 (108, 'Cadeira Ergonômica',  'Móveis',       1290.00,  3);
SELECT setval('produtos_id_seq', 108);

INSERT INTO clientes (nome, email, telefone) VALUES
 ('Ana Souza',      'ana.souza@email.com',    '(47) 99111-2233'),
 ('Bruno Lima',     'bruno.lima@email.com',   '(47) 99222-3344'),
 ('Carla Mendes',   'carla.mendes@email.com', '(47) 99333-4455'),
 ('Diego Ferreira', 'diego.f@email.com',      '(47) 99444-5566');

-- Algumas vendas dos últimos dias para o painel não começar vazio
INSERT INTO vendas (id, cliente_id, total, forma_pagamento, criado_em) VALUES
 (1, 1, 3580.00, 'credito',  NOW() - INTERVAL '6 days'),
 (2, 2,  230.00, 'pix',      NOW() - INTERVAL '5 days'),
 (3, 3,  899.90, 'debito',   NOW() - INTERVAL '3 days'),
 (4, NULL, 499.80, 'dinheiro', NOW() - INTERVAL '2 days'),
 (5, 4, 1749.00, 'pix',      NOW() - INTERVAL '1 day');
SELECT setval('vendas_id_seq', 5);

INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, subtotal) VALUES
 (1, 101, 1, 3500.00, 3500.00),
 (1, 102, 1,   80.00,   80.00),
 (2, 102, 1,   80.00,   80.00),
 (2, 103, 1,  150.00,  150.00),
 (3, 104, 1,  899.90,  899.90),
 (4, 105, 2,  249.90,  499.80),
 (5, 108, 1, 1290.00, 1290.00),
 (5, 107, 1,  459.00,  459.00);
