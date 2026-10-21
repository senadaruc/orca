import { describe, expect, it } from 'vitest'
import { parseGrazrStatusReport } from './grazr-status-report'

describe('parseGrazrStatusReport', () => {
  it('returns null when the text is not a JSON object', () => {
    expect(parseGrazrStatusReport('')).toBeNull()
    expect(parseGrazrStatusReport('not json')).toBeNull()
    expect(parseGrazrStatusReport('[]')).toBeNull()
    expect(parseGrazrStatusReport('null')).toBeNull()
  })

  it('fills every missing field with its empty value', () => {
    expect(parseGrazrStatusReport('{}')).toEqual({
      version: null,
      installed: null,
      managed_profile: false,
      connection: { statusline: null, failure_hook: null, foreign: null },
      active: null,
      accounts: [],
      order: [],
      settings: { enabled: false, model_limits: false, thresholds: { session: 0, weekly: 0 } }
    })
  })

  it('keeps a reported installed flag and leaves an unreported one null', () => {
    expect(parseGrazrStatusReport('{"installed": false}')?.installed).toBe(false)
    expect(parseGrazrStatusReport('{"installed": true}')?.installed).toBe(true)
    expect(parseGrazrStatusReport('{}')?.installed).toBeNull()
  })

  it('fills a missing threshold with zero and ignores fields it does not know', () => {
    const report = parseGrazrStatusReport(
      '{"surprise": "x", "settings": {"enabled": true, "future_knob": 1, "thresholds": {"session": 15}}}'
    )
    expect(report?.settings).toEqual({
      enabled: true,
      model_limits: false,
      thresholds: { session: 15, weekly: 0 }
    })
    expect(report).not.toHaveProperty('surprise')
  })

  it('drops accounts without an id and order entries that are not strings', () => {
    const report = parseGrazrStatusReport(
      JSON.stringify({
        accounts: [{ id: 'a', name: 'a' }, { name: 'no id' }, 'junk', null],
        order: ['a', 7, 'b']
      })
    )
    expect(report?.accounts.map((a) => a.id)).toEqual(['a'])
    expect(report?.order).toEqual(['a', 'b'])
  })

  it('reads a snapshot entry with a non-numeric remaining or reset as absent, and drops non-object entries', () => {
    const report = parseGrazrStatusReport(
      JSON.stringify({
        accounts: [
          {
            id: 'a',
            name: 'a',
            snapshot: [
              'junk',
              { kind: 'session', scope: null, group: 'session', remaining: 'lots', resets_at: 7 }
            ]
          }
        ]
      })
    )
    expect(report?.accounts[0]?.snapshot).toEqual([
      { kind: 'session', scope: null, group: 'session', remaining: null, resets_at: null }
    ])
  })

  it('reads an unread account snapshot as null, not as an empty list', () => {
    const report = parseGrazrStatusReport(
      '{"accounts": [{"id": "a", "name": "a", "snapshot": null}]}'
    )
    expect(report?.accounts[0]?.snapshot).toBeNull()
  })

  it('treats an active login without an id as nobody being logged in', () => {
    expect(parseGrazrStatusReport('{"active": {"name": "a"}}')?.active).toBeNull()
    expect(parseGrazrStatusReport('{"active": {"id": "a", "name": "a"}}')?.active).toEqual({
      id: 'a',
      name: 'a'
    })
  })
})
