#!/usr/bin/env bash
# Run the full local stack: the Worker (API + local D1) and the Vite SPA dev server.
#   Worker + /api + D1  -> http://localhost:8787
#   SPA (HMR, proxies /api) -> http://localhost:5173   <- open this one
# Ctrl+C stops both.
set -euo pipefail

# Kill the whole process group (both servers) on exit / Ctrl+C.
trap 'kill 0' EXIT INT TERM

npm run dev &       # wrangler dev
npm run dev:web &   # vite dev

wait
