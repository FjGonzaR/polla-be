# Coding rules

## Separación de capas

Sin excepción:

- **`routes/`** — parsear body/params, llamar service, devolver response. Cero lógica de dominio.
- **`services/`** — toda la lógica de negocio. Accede a Prisma directamente. Lanza `AppError` para errores esperados.
- **`lib/`** — utilidades puras sin acoplamiento a Fastify.

## DTOs y mappers

Los servicios nunca retornan tipos de Prisma directamente. Todo lo que sale hacia la ruta pasa por un mapper en `src/mappers/<feature>.mapper.ts`.

```ts
// src/mappers/group.mapper.ts
export interface TeamDto { id: string; name: string; code: string; isTop8: boolean }
export interface GroupDto { id: string; label: string; name: string; teams: TeamDto[] }

export function toTeamDto(team: Team): TeamDto { ... }
export function toGroupDto(group: Group & { teams: Team[] }): GroupDto { ... }
```

```ts
// src/services/groups.service.ts
export async function findAllGroups(): Promise<GroupDto[]> {
  const rows = await prisma.group.findMany({ include: { teams: true } })
  return rows.map(toGroupDto)
}
```

Reglas:
- Excluir campos internos: `externalTeamId`, `createdAt`, `updatedAt`, claves foráneas redundantes.
- El tipo de retorno del servicio debe ser explícito (`Promise<GroupDto[]>`), no inferido.
- Un archivo por dominio: `group.mapper.ts`, `participant.mapper.ts`, etc.

## Errores

Usar siempre `AppError(statusCode, code, message)`:

```ts
throw new AppError(404, 'INVITE_NOT_FOUND', 'Código de invitación no encontrado')
```

- El error handler global en `server.ts` serializa como `{ code, message }`.
- Códigos en SCREAMING_SNAKE_CASE.
- No agregar `try/catch` en routes para errores de dominio — dejarlos subir.

## Auth en routes

Declarar preHandlers en el objeto de opciones:

```ts
// cualquier participante autenticado
fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => { ... })

// solo admin
fastify.post('/admin/x', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, ...)
```

`request.user` queda disponible con el `Participant` completo después de `fastify.authenticate`.

## Imports

Siempre con extensión `.js` (salida CommonJS):

```ts
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/prisma.js'
```

## TypeScript

- Strict activado — no usar `any`.
- Body sin schema Fastify: castear como `request.body as { field?: string }`.
- Tipos de Prisma importados directamente de `@prisma/client`.

## Linting

`npm run build` es el linter. Debe pasar en 0 errores antes de todo commit. No hay ESLint; TypeScript strict es suficiente.
