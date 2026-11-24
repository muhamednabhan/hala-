#!/usr/bin/env bash
# Deploy the dashboard to Vercel production: ./deploy.sh
#
# Deploys a clean copy without git history: Vercel blocks deployments whose git commit author isn't on the
# Vercel account (the repo is shared, the Vercel project is yours). Secrets are never copied; Vercel uses the
# Environment Variables set on the project.
set -euo pipefail
cd "$(dirname "$0")"

npm run build   # type-check + build locally first: never ship a broken build
npm test

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
rsync -a --exclude node_modules --exclude dist --exclude '.env*' --exclude '*.test.ts' ./ "$tmp/"
cp .env.example "$tmp/"

cd "$tmp"
npx --yes vercel@65.14.0 deploy --prod --yes
