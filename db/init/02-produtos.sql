-- Banco do microsserviço de PRODUTOS
\connect produtos_db
SET ROLE produtos_user;

CREATE TABLE produtos (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(120)   NOT NULL,
    categoria   VARCHAR(60)    NOT NULL DEFAULT 'Geral',
    preco       NUMERIC(10,2)  NOT NULL CHECK (preco >= 0),
    estoque     INTEGER        NOT NULL DEFAULT 0 CHECK (estoque >= 0),
    ativo       BOOLEAN        NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

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
