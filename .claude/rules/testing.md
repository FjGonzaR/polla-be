# Testing rules

## Principio

**Solo tests de integración contra BD real.** Nunca mockear Prisma.

La BD de tests se configura con `TEST_DATABASE_URL`. Si no está definida, usa `DATABASE_URL`. Setup de una BD de tests separada:

```bash
createdb polla_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test \
  npx prisma migrate deploy
```

Correr tests contra ella:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test npm test
```

## Lo único que se mockea

Llamadas HTTP externas (Google OAuth, worldcup API). Nunca Prisma.

```ts
const { mockVerifyGoogleToken } = vi.hoisted(() => ({
  mockVerifyGoogleToken: vi.fn(),
}))

vi.mock('../../lib/google-auth.js', () => ({
  verifyGoogleToken: mockVerifyGoogleToken,
}))
```

`vi.hoisted()` y `vi.mock()` van al nivel del módulo, no dentro de `describe`.

## Estructura de un test file

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { buildMyModel } from '../builders/my-model.builder.js'

describe('POST /feature', () => {
  it('caso exitoso → 201 + registro en BD', async () => {
    // Arrange
    const { cookie } = await createAuthenticatedParticipant()
    await buildMyModel({ field: 'value' })

    // Act
    const server = await buildServer()
    const res = await server.inject({
      method: 'POST',
      url: '/feature',
      headers: { cookie },
      payload: { field: 'value' },
    })

    // Assert HTTP
    expect(res.statusCode).toBe(201)
    expect(res.json().field).toBe('value')

    // Assert BD
    const row = await prisma.myModel.findFirst({ where: { field: 'value' } })
    expect(row).not.toBeNull()
  })

  it('sin autenticación → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/feature', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})
```

## Helpers disponibles

| Helper | Cuándo usarlo |
|---|---|
| `buildInvitation(overrides?)` | Crear invitaciones de prueba en BD |
| `buildParticipant(overrides?)` | Crear participantes de prueba en BD |
| `createAuthenticatedParticipant(opts?)` | Rutas que requieren `fastify.authenticate` |
| `createAuthenticatedAdmin(opts?)` | Rutas que requieren `fastify.requireAdmin` |

Retornan `{ participant, cookie }`. Usar `cookie` directo en `headers: { cookie }`.

## Cleanup

`src/tests/setup.ts` ejecuta `afterEach` que borra tablas. Al agregar un modelo nuevo, añadirlo ahí:

```ts
afterEach(async () => {
  // borrar hijos antes que padres (orden FK)
  await prisma.nuevoModelo.deleteMany()
  await prisma.participant.deleteMany()
  await prisma.invitation.deleteMany()
})
```

## Casos mínimos por endpoint

Todo endpoint debe tener al menos:

- Caso exitoso con verificación en BD
- Sin autenticación → 401 (si la ruta lo requiere)
- Sin permisos → 403 (si requiere admin)
- Recurso no encontrado → 404 (si aplica)
- Datos inválidos → 400 (si hay validación)
- Estado bloqueado → 423 (si aplica candado)

## Configuración Vitest

`fileParallelism: false` — tests corren en serie para evitar conflictos en BD. No cambiar.
