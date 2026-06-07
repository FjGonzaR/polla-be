# Scaffolding rules

## Checklist para un nuevo endpoint

Seguir este orden exacto:

1. **Service** — `src/services/<feature>.service.ts`
   - Toda la lógica de dominio aquí.
   - Lanzar `AppError` para errores esperados.

2. **Route** — `src/routes/<feature>.ts`
   - Solo HTTP: parsear, llamar service, responder.
   - Registrar en `server.ts`: `server.register(<feature>Routes, { prefix: '/<feature>' })`

3. **Builder** (si hay modelo Prisma nuevo) — `src/tests/builders/<model>.builder.ts`
   - Factory async que inserta en BD real con `prisma.<model>.create(...)`.
   - Aceptar `overrides: Partial<...>` con defaults razonables.

4. **Setup cleanup** — `src/tests/setup.ts`
   - Añadir `await prisma.<nuevoModelo>.deleteMany()` en `afterEach`.
   - Respetar orden FK: borrar hijos antes que padres.

5. **Tests** — `src/tests/<feature>/<feature>-<method>.test.ts`
   - Un `describe` por endpoint, un `it` por caso.
   - Ver testing rules para la estructura.

6. **Verificar** — `npm run build && npm test`
   - Ambos deben pasar antes de considerar el trabajo terminado.

## Estructura de un route file

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

## Estructura de un service file

```ts
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'

export async function myService(participantId: string) {
  const item = await prisma.myModel.findUnique({ where: { id: participantId } })
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Recurso no encontrado')
  return item
}
```

## Estructura de un builder

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
