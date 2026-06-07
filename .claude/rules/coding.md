# Coding rules

## Language

All code must be written in English: variable names, function names, comments, error messages, string literals, test descriptions, and any text that appears in source files. No Spanish in code.

## Layer separation

No exceptions:

- **`routes/`** — parse body/params, call service, return response. Zero domain logic.
- **`services/`** — all business logic. Accesses Prisma directly. Throws `AppError` for expected errors.
- **`lib/`** — pure utilities with no Fastify coupling.

## DTOs and mappers

Services never return Prisma types directly. Everything sent to a route goes through a mapper in `src/mappers/<feature>.mapper.ts`.

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

Rules:
- Exclude internal fields: `externalTeamId`, `createdAt`, `updatedAt`, redundant foreign keys.
- Service return type must be explicit (`Promise<GroupDto[]>`), not inferred.
- One file per domain: `group.mapper.ts`, `participant.mapper.ts`, etc.

## Errors

Always use `AppError(statusCode, code, message)`:

```ts
throw new AppError(404, 'INVITE_NOT_FOUND', 'Invitation code not found')
```

- The global error handler in `server.ts` serializes as `{ code, message }`.
- Codes in SCREAMING_SNAKE_CASE.
- Do not add `try/catch` in routes for domain errors — let them bubble up.

## Auth in routes

Declare preHandlers in the options object:

```ts
// any authenticated participant
fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => { ... })

// admin only
fastify.post('/admin/x', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, ...)
```

`request.user` is available with the full `Participant` after `fastify.authenticate`.

## Imports

Always with `.js` extension (CommonJS output):

```ts
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/prisma.js'
```

## TypeScript

- Strict enabled — do not use `any`.
- Body without Fastify schema: cast as `request.body as { field?: string }`.
- Prisma types imported directly from `@prisma/client`.

## Linting

`npm run build` is the linter. Must pass with 0 errors before every commit. No ESLint; TypeScript strict is sufficient.
