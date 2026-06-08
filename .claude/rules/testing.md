# Testing rules

## Language

All code must be in English. See coding rules.

## Principle

**Integration tests against a real DB only.** Never mock Prisma.

The test DB is configured with `TEST_DATABASE_URL`. If not set, falls back to `DATABASE_URL`. One-time test DB setup:

```bash
createdb polla_test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test \
  npx prisma migrate deploy
```

Run tests against it:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test npm test
```

## What gets mocked

Only external HTTP calls (Google OAuth, worldcup API). Never Prisma.

```ts
const { mockVerifyGoogleToken } = vi.hoisted(() => ({
  mockVerifyGoogleToken: vi.fn(),
}))

vi.mock('../../lib/google-auth.js', () => ({
  verifyGoogleToken: mockVerifyGoogleToken,
}))
```

`vi.hoisted()` and `vi.mock()` go at module level, not inside `describe`.

## Test file structure

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { createAuthenticatedParticipant, createAuthenticatedAdmin } from '../helpers/auth.helper.js'
import { buildMyModel } from '../builders/my-model.builder.js'

describe('POST /feature', () => {
  it('success → 201 + record in DB', async () => {
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

    // Assert DB
    const row = await prisma.myModel.findFirst({ where: { field: 'value' } })
    expect(row).not.toBeNull()
  })

  it('no auth → 401', async () => {
    const server = await buildServer()
    const res = await server.inject({ method: 'POST', url: '/feature', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})
```

## Available helpers

| Helper | When to use |
|---|---|
| `buildInvitation(overrides?)` | Create test invitations in DB |
| `buildParticipant(overrides?)` | Create test participants in DB |
| `createAuthenticatedParticipant(opts?)` | Routes requiring `fastify.authenticate` |
| `createAuthenticatedAdmin(opts?)` | Routes requiring `fastify.requireAdmin` |

Return `{ participant, cookie }`. Use `cookie` directly in `headers: { cookie }`.

## Cleanup

`src/tests/setup.ts` runs `afterEach` that clears tables. When adding a new model, add it there:

```ts
afterEach(async () => {
  // delete children before parents (FK order)
  await prisma.newModel.deleteMany()
  await prisma.participant.deleteMany()
  await prisma.invitation.deleteMany()
})
```

## Minimum cases per endpoint

Every endpoint must have at least:

- Success case with DB verification
- No auth → 401 (if route requires it)
- No permissions → 403 (if admin required)
- Resource not found → 404 (if applicable)
- Invalid data → 400 (if validation exists)
- Locked state → 423 (if a lock applies)

## Schema sync before running tests

Before running tests (and before writing new tests that touch a new model), verify the Prisma client is in sync with the current schema:

```bash
# Check for pending migrations
npx prisma migrate status

# If any migrations are not applied to the test DB, apply them:
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/polla_test \
  npx prisma migrate deploy

# Regenerate the client after any schema change or new migration:
npx prisma generate
```

**Why this matters:** If a migration exists but `npx prisma generate` has not been run, the Prisma client will not know about the new model/field. Tests that reference `prisma.<newModel>` (including `setup.ts` cleanup) will crash with a runtime error — not a type error — so the build may pass but the test run fails. This was observed with `matchReminder` after migration `20260608031335_add_match_reminder` was added without regenerating the client.

**Rule:** Any time you add or modify a Prisma migration (new model, new field, renamed field), run `npx prisma generate` before running tests. If tests fail with `prisma.<model> is not a function` or similar, this is the first thing to check.

## Vitest config

`fileParallelism: false` — tests run serially to avoid DB conflicts. Do not change.
