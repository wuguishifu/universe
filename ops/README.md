# bootstrap new machine

1. Clone the git history

   ```sh
   git clone --filter=blob:none --no-checkout https://github.com/wuguishifu/universe.git universe
   cd ops
   ```

1. Add the machine's ops (e.g. `ops/sol`) directory to the sparse checkout

   ```sh
   git sparse-checkout disable
   git sparse-checkout init --no-cone
   git sparse-checkout set ops/sol/\* # important to include /\* so it only checks out subfiles of `ops/sol`
   ```

1. Check out the files

   ```sh
   git checkout develop
   ```

1. (Optional) Add the config to your ssh config

   ```sshconfig
   Host sol
      HostName 100.81.149.1
      User bo
      Port 22
      IdentityFile ~/Documents/.Authentication/ssh-keys/sol/sol
      RequestTTY yes
      RemoteCommand cd ~/Documents/universe/ops/sol && exec zsh -l
   ```
