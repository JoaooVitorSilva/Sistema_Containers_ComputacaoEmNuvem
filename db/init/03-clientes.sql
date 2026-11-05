-- Banco do microsserviço de CLIENTES
\connect clientes_db
SET ROLE clientes_user;

CREATE TABLE clientes (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(120)  NOT NULL,
    email       VARCHAR(120),
    telefone    VARCHAR(30),
    criado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO clientes (nome, email, telefone) VALUES
 ('Ana Souza',      'ana.souza@email.com',    '(47) 99111-2233'),
 ('Bruno Lima',     'bruno.lima@email.com',   '(47) 99222-3344'),
 ('Carla Mendes',   'carla.mendes@email.com', '(47) 99333-4455'),
 ('Diego Ferreira', 'diego.f@email.com',      '(47) 99444-5566');
