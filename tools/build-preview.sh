#!/usr/bin/env bash
# Builds a single-file copy of a game (no Nostr) for sandboxed previews such as Claude artifacts.
# Usage: tools/build-preview.sh [game-folder] [output-file]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; GAME="${1:-bomber}"; OUT="${2:-$ROOT/dist/$GAME-preview.html}"; mkdir -p "$(dirname "$OUT")"
JS="$(mktemp --suffix=.js)"
bun build "$ROOT/$GAME/js/main.js" --target=browser --format=iife --minify --define __ARCADE_PREVIEW__=true --outfile="$JS" >/dev/null
python3 - "$ROOT" "$GAME" "$JS" "$OUT" <<'PY'
import sys, re
root, game, js, out = sys.argv[1:5]
html = open(f'{root}/{game}/index.html').read()
title = re.search(r'<title>(.*?)</title>', html).group(1)
body = html[html.index('<body>') + 6: html.index('</body>')]
css = open(f'{root}/kit/arcade.css').read() + '\n' + open(f'{root}/{game}/css/{game}.css').read()
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)
page = f'''<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="{fonts}">
<style>
{css}</style>
{body}
<script>
{open(js).read()}</script>
'''
open(out, 'w').write(page)
print('wrote', out, len(page) // 1024, 'KB')
PY
