# Polla Mundial 2026 — Backend

Backend del pool privado de predicciones del Mundial 2026. Node.js 22 + Fastify 4 + Prisma 5 + PostgreSQL.

## Stack

- **Runtime:** Node.js 22 LTS
- **Framework:** Fastify 4
- **ORM:** Prisma 5
- **Auth:** Google OAuth 2.0 + cookie de sesión JWT (HttpOnly, 30d)
- **Tests:** Vitest — integración contra BD real
- **Contenedor:** Docker + Docker Compose (solo BD en local)

## Requisitos

- Node.js ≥ 22
- Docker (para la BD local)
- Una cuenta de Google Cloud con un OAuth 2.0 Client ID configurado

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno
cp .env.example .env
# Editar .env: al menos GOOGLE_CLIENT_ID y JWT_SECRET

# 3. Levantar la base de datos
docker compose up db -d

# 4. Aplicar migraciones
npx prisma migrate dev

# 5. Arrancar en modo desarrollo
npm run dev
# → http://localhost:3000
# → GET /health debe devolver { status: "ok", db: "connected" }
```

## Variables de entorno

| Variable            | Descripción                                                                | Ejemplo                                                       |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`      | Conexión Postgres                                                          | `postgresql://postgres:postgres@localhost:5433/polla_mundial` |
| `GOOGLE_CLIENT_ID`  | OAuth 2.0 Client ID de Google Cloud                                        | `xxx.apps.googleusercontent.com`                              |
| `JWT_SECRET`        | Secreto para firmar cookies de sesión                                      | cadena aleatoria larga                                        |
| `JWT_EXPIRES_IN`    | Duración de la sesión                                                      | `30d`                                                         |
| `COOKIE_SAME_SITE`  | `lax` si FE/BE comparten dominio, `none` si son distintos (requiere HTTPS) | `lax`                                                         |
| `CORS_ORIGIN`       | URL del frontend                                                           | `http://localhost:5173`                                       |
| `WORLDCUP_API_URL`  | API externa de resultados                                                  | `https://worldcup26.ir`                                       |
| `TEST_DATABASE_URL` | BD separada para tests (opcional)                                          | `postgresql://.../polla_test`                                 |
| `PORT`              | Puerto del servidor                                                        | `3000`                                                        |

## Comandos

```bash
npm run dev          # desarrollo con hot reload
npm run build        # compilar TypeScript (también sirve como linter)
npm start            # producción (requiere build previo)
npm test             # tests de integración
npm run test:watch   # tests en modo watch
npm run test:coverage

npx prisma migrate dev      # crear y aplicar migración
npx prisma migrate deploy   # aplicar en producción
npx prisma generate         # regenerar cliente tras cambios en schema
npx prisma studio           # GUI para la BD
```

## Tests

Los tests son de integración — corren contra una BD real. Se recomienda una BD separada:

```bash
# Crear BD de tests (una vez)
createdb polla_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test \
  npx prisma migrate deploy

# Correr tests
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test npm test

# Archivo específico
TEST_DATABASE_URL=... npx vitest run src/tests/auth/auth-google.test.ts
```

## Deploy (Oracle Cloud Free Tier)

Servidor: VM.Standard.A1.Flex (ARM), Ubuntu 22.04. App corre con PM2 detrás de Nginx. PostgreSQL en la misma VM.

- **URL:** https://api.paulpredice.com
- **DNS:** Cloudflare con proxy habilitado, SSL Full (strict)
- **Repo en servidor:** `~/polla-be`

### Primer deploy (setup inicial)

```bash
# En el VM
git clone <repo-url> ~/polla-be
cd ~/polla-be
npm install
cp .env.example .env
# Editar .env con valores de producción

npx prisma migrate deploy
npm run build
pm2 start dist/server.js --name polla-be
pm2 save
pm2 startup  # seguir las instrucciones que imprime
```

### Redesplegar cambios

```bash
~/polla-be/deploy.sh
```

El script `deploy.sh` en la raíz del repo hace: `git pull` → `npm install` → `prisma migrate deploy` → `npm run build` → `pm2 restart`.

Primera vez en un VM nuevo, darle permisos de ejecución:

```bash
chmod +x ~/polla-be/deploy.sh
```

### Ver logs

```bash
pm2 logs polla-be           # tiempo real
pm2 logs polla-be --lines 100
pm2 logs polla-be --err     # solo errores
pm2 logs polla-be --out     # solo stdout
```

## Contrato API

La especificación OpenAPI 3.1.0 está en `docs/api-contract.yaml`. Los endpoints disponibles se describen en `docs/EPs definition.md`.

Endpoints implementados: `GET /health`, `POST /auth/google`, `POST /auth/logout`.
