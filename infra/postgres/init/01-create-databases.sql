-- Database-per-service pattern.
-- Each microservice owns an isolated database — no shared tables, no cross-service joins.
-- State is synchronized only through Kafka events.
--
-- This script runs once, automatically, on first Postgres startup.

CREATE DATABASE order_service;
CREATE DATABASE payment_service;
CREATE DATABASE inventory_service;
CREATE DATABASE notification_service;

-- All owned by the same local dev user for simplicity.
-- In production each service would have its own credentials with least-privilege access.
GRANT ALL PRIVILEGES ON DATABASE order_service        TO ecommerce;
GRANT ALL PRIVILEGES ON DATABASE payment_service      TO ecommerce;
GRANT ALL PRIVILEGES ON DATABASE inventory_service    TO ecommerce;
GRANT ALL PRIVILEGES ON DATABASE notification_service TO ecommerce;
