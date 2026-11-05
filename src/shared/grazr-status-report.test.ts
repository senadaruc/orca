import { describe, expect, it } from 'vitest'
import { grazrPlanLabel, parseGrazrStatusReport } from './grazr-status-report'

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
      changed_at: null,
      settings: { enabled: false, model_limits: false, thresholds: { session: 0, weekly: 0 } }
    })
  })

  it('reads each account plan, organization and reading time, absent on an older engine', () => {
    const report = parseGrazrStatusReport(
      JSON.stringify({
        changed_at: 1700000000.5,
        accounts: [
          {
            id: 'a',
            name: 'a',
            organization: "a's Organization",
            plan: { type: 'claude_max', tier: 'default_claude_max_20x', seat_tier: null },
            updated: 1699999000
          },
          { id: 'b', name: 'b', plan: { tier: 'no type' } }
        ]
      })
    )
    expect(report?.changed_at).toBe(1700000000.5)
    expect(report?.accounts[0]).toMatchObject({
      organization: "a's Organization",
      plan: { type: 'claude_max', tier: 'default_claude_max_20x', seat_tier: null },
      updated: 1699999000
    })
    expect(report?.accounts[1]).toMatchObject({ organization: null, plan: null, updated: null })
  })

  it('labels a plan with its multiplier, the seat tier before the organization tier', () => {
    expect(grazrPlanLabel({ type: 'claude_pro', tier: null, seat_tier: null })).toBe('Pro')
    expect(
      grazrPlanLabel({ type: 'claude_max', tier: 'default_claude_max_20x', seat_tier: null })
    ).toBe('Max 20x')
    expect(
      grazrPlanLabel({
        type: 'claude_team',
        tier: 'default_claude_max_20x',
        seat_tier: 'default_claude_max_5x'
      })
    ).toBe('Team 5x')
    expect(grazrPlanLabel({ type: 'claude_free_trial', tier: 'x', seat_tier: null })).toBe(
      'Free Trial'
    )
  })

  it('reads a managed profile given as a config path, a flag, or null as a boolean', () => {
    expect(
      parseGrazrStatusReport('{"managed_profile": "/Users/a/.config/orca-grazr/managed.json"}')
        ?.managed_profile
    ).toBe(true)
    expect(parseGrazrStatusReport('{"managed_profile": true}')?.managed_profile).toBe(true)
    expect(parseGrazrStatusReport('{"managed_profile": ""}')?.managed_profile).toBe(false)
    expect(parseGrazrStatusReport('{"managed_profile": null}')?.managed_profile).toBe(false)
    expect(parseGrazrStatusReport('{"managed_profile": 3}')?.managed_profile).toBe(false)
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
