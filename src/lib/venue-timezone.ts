// IANA timezone per World Cup 2026 stadium (keyed by the external API's stadium_id).
// Mexico has no DST since 2022; USA/Canada do (EDT/CDT/MDT/PDT in June–July).
export const STADIUM_TIMEZONES: Record<string, string> = {
  '1': 'America/Mexico_City', // Estadio Azteca — Mexico City
  '2': 'America/Mexico_City', // Estadio Akron — Guadalajara
  '3': 'America/Monterrey', // Estadio BBVA — Monterrey
  '4': 'America/Chicago', // AT&T Stadium — Dallas
  '5': 'America/Chicago', // NRG Stadium — Houston
  '6': 'America/Chicago', // Arrowhead — Kansas City
  '7': 'America/New_York', // Mercedes-Benz — Atlanta
  '8': 'America/New_York', // Hard Rock — Miami
  '9': 'America/New_York', // Gillette — Boston (Foxborough)
  '10': 'America/New_York', // Lincoln Financial — Philadelphia
  '11': 'America/New_York', // MetLife — New York/New Jersey
  '12': 'America/Toronto', // BMO Field — Toronto
  '13': 'America/Vancouver', // BC Place — Vancouver
  '14': 'America/Los_Angeles', // Lumen Field — Seattle
  '15': 'America/Los_Angeles', // Levi's — SF Bay Area (Santa Clara)
  '16': 'America/Los_Angeles', // SoFi — Los Angeles (Inglewood)
}

const LOCAL_DATE_REGEX = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/

// Offset (ms) of a timezone at a given instant — positive when ahead of UTC.
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10)
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - instant.getTime()
}

// Wall-clock time in `timeZone` → the UTC instant. DST-safe (offset computed at the date).
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  return new Date(guess - tzOffsetMs(new Date(guess), timeZone))
}

/**
 * Parses the external API's `local_date` ("MM/DD/YYYY HH:mm", venue-local time) into a
 * correct UTC Date, using the stadium's timezone. Unknown/missing stadiumId falls back to
 * treating the string as UTC (the previous behavior) and warns.
 */
export function parseVenueLocalDate(localDate: string, stadiumId?: string | null): Date {
  const match = LOCAL_DATE_REGEX.exec(localDate)
  if (!match) {
    // Best-effort: let Date try to parse whatever format this is.
    return new Date(localDate)
  }

  const [, month, day, year, hour, minute] = match
  const timeZone = stadiumId != null ? STADIUM_TIMEZONES[stadiumId] : undefined

  if (!timeZone) {
    console.warn(
      `[venue-timezone] Unknown stadiumId "${stadiumId ?? ''}" — treating local_date as UTC`,
    )
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`)
  }

  return zonedWallTimeToUtc(
    parseInt(year, 10),
    parseInt(month, 10),
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    timeZone,
  )
}
