# postgres-utils

A library used by developers to manage and interact with Universe DB.

This is explicitly split out from the `postgres-db` lib because it requires the use of sensitive environment variables.

## Setup

1. Make sure you have [Docker](https://docs.docker.com/engine/install/) installed

1. Run `nx docker postgres-utils` to create your docker postgres container and seed the DB ✅
   - You can verify it worked by connecting to the docker postgres container with the following command:
     `docker exec -it universe-db psql --username postgres --dbname universe`

## Migrations

When you need to make DB changes, do so by updating the `schema` models in `platform/postgres/db`.

Once you're done perform the following steps:

1. Generate your migration by running `nx migrate:generate postgres-utils`

1. Check and verify the generated SQL for the migration

1. Execute the migration by running `nx migrate:run postgres-utils`

**Important:** Migrations will be executed against the environment that you're pointing to with your `ENVIRONMENT` variable in your `.env` file

## pgAdmin

Running `nx docker postgres-utils` will also spin up a [pgAdmin](https://www.pgadmin.org/) you can play around with.

To access pgAdmin, first navigate to [http://localhost:5050](http://localhost:5050). Then, log in with the following credentials:

- username: `admin@universe.dev`
- password: `admin`

The pre-configured server uses trust auth, so no password is needed to connect.
