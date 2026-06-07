# Scaffolding rules

## Language

All code must be in English. See coding rules.

## Checklist for a new endpoint

Follow this exact order:

1. **Service** — `src/services/<feature>.service.ts`
   - All domain logic here.
   - Throw `AppError` for expected errors.

2. **Route** — `src/routes/<feature>.ts`
   - HTTP only: parse, call service, respond.
   - Register in `server.ts`: `server.register(<feature>Routes, { prefix: '/<feature>' })`

3. **Builder** (if there is a new Prisma model) — `src/tests/builders/<model>.builder.ts`
   - Async factory that inserts into a real DB with `prisma.<model>.create(...)`.
   - Accept `overrides: Partial<...>` with sensible defaults.

4. **Setup cleanup** — `src/tests/setup.ts`
   - Add `await prisma.<newModel>.deleteMany()` in `afterEach`.
   - Respect FK order: delete children before parents.

5. **Tests** — `src/tests/<feature>/<feature>-<method>.test.ts`
   - One `describe` per endpoint, one `it` per case.
   - See testing rules for structure.

6. **Verify** — `npm run build && npm test`
   - Both must pass before considering the work done.

## Route file structure

```ts
import type { FastifyInstance } from 'fastify'
import { myService } from '../services/my.service.js'

export default async function myRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const result = await myService(request.user.id)
    return reply.code(200).send(result)
  })

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { field } = request.body as { field?: string }
    const result = await myService(field)
    return reply.code(201).send(result)
  })
}
```

## Service file structure

```ts
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'

export async function myService(participantId: string) {
  const item = await prisma.myModel.findUnique({ where: { id: participantId } })
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Resource not found')
  return item
}
```

## Builder structure

```ts
import { type MyModel } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

interface MyModelOverrides {
  field?: string
}

export async function buildMyModel(overrides: MyModelOverrides = {}): Promise<MyModel> {
  return prisma.myModel.create({
    data: {
      field: overrides.field ?? 'default-value',
    },
  })
}
```
