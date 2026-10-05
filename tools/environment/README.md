# environment

This library handles secrets integration and storage with [infisical](https://infisical.wuguishifu.dev).

## Setup

1. Install and connect to [Tailscale](https://tailscale.com/).

1. Install the [Infisical CLI](https://infisical.com/docs/cli/overview).

   ```sh
   brew install infisical/get-cli/infisical
   ```

1. Log into the Infisical CLI.

   ```sh
   nx auth environment
   ```

1. Copy the root `.env.example` file to `.env`.

1. Run the setup command.

   ```sh
   nx setup environment
   ```

## Adding an app

Add an `environment-config.json` to the root of any app that needs environment variables. The setup command finds these files (including uncommitted ones) and writes a `.env.local` next to each.

```json
{
  "$schema": "../../../tools/environment/environment-config.schema.json",
  "secretsPaths": ["projects/portfolio/web"],
  "hasConvex": true,
  "publicPrefix": "NEXT_PUBLIC_"
}
```

`secretsPaths` lists the Infisical paths to load secrets from. Paths are applied in order, so a key in a later path overrides the same key in an earlier one. Omit it if the app has no secrets.

All keys are optional; see [`environment-config.schema.json`](./environment-config.schema.json) for what they do. Unknown keys cause the setup command to fail.
