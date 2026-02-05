# db-hydrogen-utils

A library used by developers to manage and interact with Hydrogen DB.

This is explicitly split out from the `db-hydrogen` lib because it requires the use of sensitive environment variables.

## Setup

1. Make sure you have [Docker](https://docs.docker.com/engine/install/) installed

1. Run `nx docker db-hydrogen-utils` to create your docker postgres container and seed the DB ✅

   - You can verify it worked by connecting to the docker postgres container with the following command:
     `docker exec -it hydrogen-db psql --username postgres --dbname hydrogen`

## Migrations

When you need to make DB changes, do so by updating the `schema` models in `hydrogen`.

Once you're done perform the following steps:

1. Generate your migration by running `nx migrate:generate db-hydrogen-utils`

1. Check and verify the generated SQL for the migration

1. Execute the migration by running `nx migrate:run db-hydrogen-utils`

**Important:** Migrations will be executed against the environment that you're pointing to with your `ENVIRONMENT` variable in your `.env` file

## Redash/pgAdmin

Running `nx docker db-hydrogen-utils` will also spin up a [pgAdmin](https://www.pgadmin.org/) and a [Redash](https://redash.io/) instance that you can play around with.

To access pgAdmin, first navigate to [http://localhost:5050](http://localhost:5050). Then, log in with the following credentials:

- username: `admin@local.dev`
- password: `admin`

The password for the pre-configured server is `admin` as well.

To access Redash, navigate to [http://localhost:5051](http://localhost:5051).
