#!/bin/sh
# Startup wrapper for ideate-artifact-server.
# Installs dependencies on first run if node_modules is missing,
# then starts the MCP server.

DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for .package-lock.json — created by npm only after a successful install.
# Checking the directory alone is unreliable: a partial install leaves node_modules
# present but incomplete, causing silent failures on startup.
if [ ! -f "$DIR/node_modules/.package-lock.json" ]; then
  echo "ideate-artifact-server: installing dependencies (first run)..." >&2
  npm install --prefix "$DIR" --omit=dev --silent
  if [ $? -ne 0 ]; then
    echo "ideate-artifact-server: npm install failed — check that node and npm are in PATH" >&2
    exit 1
  fi
fi

exec node "$DIR/dist/index.js"
