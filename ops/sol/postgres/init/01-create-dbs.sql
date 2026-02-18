SELECT 'CREATE DATABASE hydrogen'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hydrogen')\gexec

SELECT 'CREATE DATABASE redash'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'redash')\gexec
