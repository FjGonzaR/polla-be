import { describe, it, expect } from 'vitest'
import { parseScorersField, toAdditionalDataDto } from '../../mappers/match-additional-data.mapper.js'

describe('parseScorersField', () => {
  it('parses a normal scorers list', () => {
    const result = parseScorersField(`{"J. Quiñones 9'","R. Jiménez 67'"}`)
    expect(result).toEqual([
      { player: 'J. Quiñones', minute: 9, stoppage: null, ownGoal: false, penalty: false, display: "9'" },
      { player: 'R. Jiménez', minute: 67, stoppage: null, ownGoal: false, penalty: false, display: "67'" },
    ])
  })

  it('parses own goals and stoppage time', () => {
    const result = parseScorersField(`{"D. Bobadilla 7'(OG)","F. Balogun 45'+5'","G. Reyna 90'+8'"}`)
    expect(result[0]).toEqual({
      player: 'D. Bobadilla', minute: 7, stoppage: null, ownGoal: true, penalty: false, display: "7' (OG)",
    })
    expect(result[1]).toEqual({
      player: 'F. Balogun', minute: 45, stoppage: 5, ownGoal: false, penalty: false, display: "45'+5'",
    })
    expect(result[2]).toEqual({
      player: 'G. Reyna', minute: 90, stoppage: 8, ownGoal: false, penalty: false, display: "90'+8'",
    })
  })

  it('handles typographic (smart) quotes from the API', () => {
    // Stored with “ ” (U+201C/U+201D) instead of ASCII double quotes.
    const result = parseScorersField(`{“J. Quiñones 9'”,”R. Jiménez 67'”}`)
    expect(result).toEqual([
      { player: 'J. Quiñones', minute: 9, stoppage: null, ownGoal: false, penalty: false, display: "9'" },
      { player: 'R. Jiménez', minute: 67, stoppage: null, ownGoal: false, penalty: false, display: "67'" },
    ])
  })

  it('detects penalties', () => {
    const [scorer] = parseScorersField(`{"H. Kane 60'(P)"}`)
    expect(scorer).toMatchObject({ player: 'H. Kane', minute: 60, penalty: true, ownGoal: false, display: "60' (P)" })
  })

  it('handles accents and initials', () => {
    expect(parseScorersField(`{"L. Krejčí 59'"}`)).toEqual([
      { player: 'L. Krejčí', minute: 59, stoppage: null, ownGoal: false, penalty: false, display: "59'" },
    ])
  })

  it('returns [] for null / "null" / empty', () => {
    expect(parseScorersField(null)).toEqual([])
    expect(parseScorersField(undefined)).toEqual([])
    expect(parseScorersField('null')).toEqual([])
    expect(parseScorersField('')).toEqual([])
    expect(parseScorersField('{}')).toEqual([])
  })

  it('falls back gracefully for an unparseable element', () => {
    const [scorer] = parseScorersField(`{"Pending review"}`)
    expect(scorer).toEqual({
      player: 'Pending review', minute: null, stoppage: null, ownGoal: false, penalty: false, display: 'Pending review',
    })
  })
})

describe('toAdditionalDataDto', () => {
  it('parses scorers and keeps stadium fields', () => {
    const dto = toAdditionalDataDto({
      homeScorers: `{"Yamal 50'"}`,
      awayScorers: 'null',
      stadiumName: 'SoFi Stadium',
      stadiumCity: 'Los Angeles (Inglewood)',
      stadiumCountry: 'United States',
      stadiumCapacity: 70000,
    })
    expect(dto?.homeScorers).toEqual([
      { player: 'Yamal', minute: 50, stoppage: null, ownGoal: false, penalty: false, display: "50'" },
    ])
    expect(dto?.awayScorers).toEqual([])
    expect(dto?.stadiumName).toBe('SoFi Stadium')
    expect(dto?.stadiumCapacity).toBe(70000)
  })

  it('returns null for non-object payloads', () => {
    expect(toAdditionalDataDto(null)).toBeNull()
    expect(toAdditionalDataDto('x')).toBeNull()
    expect(toAdditionalDataDto([1, 2])).toBeNull()
  })
})
