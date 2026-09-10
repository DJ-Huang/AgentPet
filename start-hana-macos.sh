#!/usr/bin/env bash
set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org/ and try again."
  exit 1
fi

if [[ ! -x "node_modules/.bin/electron" ]]; then
  echo "Installing Hana dependencies..."
  if ! npm install; then
    echo "Hana could not be started."
    exit 1
  fi
fi

echo "Starting Hana..."
npm start
exit $?
