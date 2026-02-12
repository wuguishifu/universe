# bootstrap new machine

1. Clone the git history

   ```sh
   git clone --filter=blob:none --no-checkout https://github.com/wuguishifu/universe.git ops
   cd ops
   ```

1. Add the `ops` directory to the sparse checkout

   ```sh
   git sparse-checkout set ops
   ```

1. Check out the files

   ```sh
   git checkout develop
   ```
