#!/bin/bash
set -e

cd ~/polla-be
git pull
npm install
npx prisma migrate deploy
npm run build
pm2 restart polla-be
echo "Deploy done"
