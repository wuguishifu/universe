CURRENT_BRANCH=$(git branch --show-current)

if [[ "main" == "$CURRENT_BRANCH" ]]; then
  echo "running \`nx run-many\`"
  nx run-many -t lint,typecheck,circular-deps --output-style=stream
else
  echo "running \`nx affected\`"
  nx affected -t lint,typecheck,circular-deps --base=main --head=HEAD --output-style=stream
fi
