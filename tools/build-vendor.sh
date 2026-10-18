#!/usr/bin/env bash
# Rebuilds kit/vendor/nostr.js from pinned release tags. Needs git and bun.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; W="$(mktemp -d)"; cd "$W"
clone() { git clone -q --depth 1 --branch "$2" "https://github.com/$1" "$3"; }
clone nbd-wtf/nostr-tools v2.25.2 nostr-tools
clone paulmillr/noble-curves 2.0.1 noble-curves
clone paulmillr/noble-hashes 2.0.1 noble-hashes
clone paulmillr/noble-ciphers 2.1.1 noble-ciphers
clone paulmillr/scure-base 2.0.0 scure-base
mkdir -p node_modules/@noble node_modules/@scure/base
for p in hashes curves ciphers; do d=node_modules/@noble/$p; mkdir -p $d; ln -s "$W/noble-$p/src" $d/src
  echo "{\"name\":\"@noble/$p\",\"type\":\"module\",\"exports\":{\"./*.js\":\"./src/*.ts\",\"./*\":\"./src/*.ts\"}}" > $d/package.json; done
ln -s "$W/scure-base/index.ts" node_modules/@scure/base/index.ts
echo '{"name":"@scure/base","type":"module","exports":{".":"./index.ts"}}' > node_modules/@scure/base/package.json
ln -s ../node_modules nostr-tools/node_modules
cp "$ROOT/tools/vendor-entry.ts" ./entry.ts
bun build entry.ts --target=browser --format=esm --minify --outfile="$ROOT/kit/vendor/nostr.js"
echo "Built kit/vendor/nostr.js"
