-- Banco do microsserviço de VENDAS
-- cliente_id e produto_id NÃO são chaves estrangeiras: esses dados
-- pertencem a outros serviços (outros bancos). Por isso a venda guarda
-- uma "foto" do nome do cliente e do produto no momento da compra.
\connect vendas_db
SET ROLE vendas_user;

CREATE TABLE vendas (
    id               SERIAL PRIMARY KEY,
    cliente_id       INTEGER,
    cliente_nome     VARCHAR(120)  NOT NULL DEFAULT 'Consumidor final',
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
    produto_id      INTEGER       NOT NULL,
    produto_nome    VARCHAR(120)  NOT NULL,
    quantidade      INTEGER       NOT NULL CHECK (quantidade > 0),
    preco_unitario  NUMERIC(10,2) NOT NULL,
    subtotal        NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_itens_venda_venda ON itens_venda(venda_id);
CREATE INDEX idx_vendas_data       ON vendas(criado_em);
CREATE INDEX idx_vendas_cliente    ON vendas(cliente_id);

-- Vendas de exemplo dos últimos dias (o estoque inicial em produtos_db já
-- considera essas vendas como feitas)
INSERT INTO vendas (id, cliente_id, cliente_nome, total, forma_pagamento, criado_em) VALUES
 (1, 1,    'Ana Souza',        3580.00, 'credito',  NOW() - INTERVAL '6 days'),
 (2, 2,    'Bruno Lima',        230.00, 'pix',      NOW() - INTERVAL '5 days'),
 (3, 3,    'Carla Mendes',      899.90, 'debito',   NOW() - INTERVAL '3 days'),
 (4, NULL, 'Consumidor final',  499.80, 'dinheiro', NOW() - INTERVAL '2 days'),
 (5, 4,    'Diego Ferreira',   1749.00, 'pix',      NOW() - INTERVAL '1 day');
SELECT setval('vendas_id_seq', 5);

INSERT INTO itens_venda (venda_id, produto_id, produto_nome, quantidade, preco_unitario, subtotal) VALUES
 (1, 101, 'Notebook',           1, 3500.00, 3500.00),
 (1, 102, 'Mouse',              1,   80.00,   80.00),
 (2, 102, 'Mouse',              1,   80.00,   80.00),
 (2, 103, 'Teclado',            1,  150.00,  150.00),
 (3, 104, 'Monitor 24"',        1,  899.90,  899.90),
 (4, 105, 'Headset Gamer',      2,  249.90,  499.80),
 (5, 108, 'Cadeira Ergonômica', 1, 1290.00, 1290.00),
 (5, 107, 'SSD 1TB',            1,  459.00,  459.00);
