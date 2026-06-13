import { describe, it, expect, vi } from 'vitest'
import { parseVenueLocalDate } from '../../lib/venue-timezone.js'

describe('parseVenueLocalDate', () => {
  it('Los Angeles (PDT, UTC-7 in June) → +7h', () => {
    // SoFi (stadium 16): 06/12/2026 18:00 local → 2026-06-13T01:00Z
    expect(parseVenueLocalDate('06/12/2026 18:00', '16').toISOString()).toBe(
      '2026-06-13T01:00:00.000Z',
    )
  })

  it('Mexico City (UTC-6, no DST) → +6h', () => {
    // Estadio Azteca (stadium 1): 06/11/2026 13:00 local → 2026-06-11T19:00Z
    expect(parseVenueLocalDate('06/11/2026 13:00', '1').toISOString()).toBe(
      '2026-06-11T19:00:00.000Z',
    )
  })

  it('New York (EDT, UTC-4 in June) → +4h', () => {
    // MetLife (stadium 11): 06/15/2026 16:00 local → 2026-06-15T20:00Z
    expect(parseVenueLocalDate('06/15/2026 16:00', '11').toISOString()).toBe(
      '2026-06-15T20:00:00.000Z',
    )
  })

  it('Toronto (EDT, UTC-4 in June) → +4h', () => {
    // BMO Field (stadium 12): 06/12/2026 15:00 local → 2026-06-12T19:00Z
    expect(parseVenueLocalDate('06/12/2026 15:00', '12').toISOString()).toBe(
      '2026-06-12T19:00:00.000Z',
    )
  })

  it('unknown stadiumId → falls back to UTC and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseVenueLocalDate('06/12/2026 18:00', '999').toISOString()).toBe(
      '2026-06-12T18:00:00.000Z',
    )
    expect(parseVenueLocalDate('06/12/2026 18:00', null).toISOString()).toBe(
      '2026-06-12T18:00:00.000Z',
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
