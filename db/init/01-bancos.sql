-- =========================================================
-- Um único contêiner PostgreSQL com UM BANCO POR MICROSSERVIÇO
-- (Database per Service). Cada serviço tem usuário próprio e
-- só consegue acessar o seu banco.
-- Os scripts desta pasta rodam só na PRIMEIRA subida do volume.
-- =========================================================

CREATE USER produtos_user PASSWORD 'produtos123';
CREATE USER clientes_user PASSWORD 'clientes123';
CREATE USER vendas_user   PASSWORD 'vendas123';

CREATE DATABASE produtos_db OWNER produtos_user;
CREATE DATABASE clientes_db OWNER clientes_user;
CREATE DATABASE vendas_db   OWNER vendas_user;

-- Ninguém além do dono conecta em cada banco
REVOKE CONNECT ON DATABASE produtos_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE clientes_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE vendas_db   FROM PUBLIC;
