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

### Deploying migrations

Production migrations ship as the `universe-db-migrations` image, built from this project's `Dockerfile` by the **Deploy Server App** workflow (`postgres/migrations`). In the homelab, the `universe-db` ArgoCD app runs it as a Job whenever a new image is published (see `manifests/universe-db` in the homelab repo).

Services deploy independently of migrations, so **every migration must work with the code that's already running**. Add columns and tables first, ship the code that uses them, and drop old ones in a later migration.

`migrate.ts` takes a Postgres advisory lock, so concurrent runs (a Job plus a manual `nx migrate:run`) wait for each other instead of racing. Without a TTY it skips the confirmation prompt. `MIGRATIONS_DIR` overrides where it looks for migrations.

To build the image's contents locally, run `nx bundle:migrate postgres-utils` (output in `dist/platform/postgres/migrations`).

## pgAdmin

Running `nx docker postgres-utils` will also spin up a [pgAdmin](https://www.pgadmin.org/) you can play around with.

To access pgAdmin, first navigate to [http://localhost:5050](http://localhost:5050). Then, log in with the following credentials:

- username: `admin@universe.dev`
- password: `admin`

The pre-configured server uses trust auth, so no password is needed to connect.
