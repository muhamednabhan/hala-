import { describe, expect, it } from 'vitest'
import { normalizeTime, resolveWhen } from '../src'

// Wednesday 25 Nov 2026, 07:30 Dubai: the time of the robot take
const now = new Date('2026-11-25T03:30:00Z')
const date = (s: string) => resolveWhen(s, now)?.date

describe('resolveWhen accepts what a language model really sends', () => {
  it.each([
    ['today', '2026-11-25'], ['Tomorrow.', '2026-11-26'], ['tomorrow morning', '2026-11-26'], ['  Thursday  ', '2026-11-26'], ['Thursday.', '2026-11-26'],
    ['thu', '2026-11-26'], ['Thurs', '2026-11-26'], ['fri', '2026-11-27'], ['mon', '2026-11-30'], ['next monday', '2026-11-30'],
    ['thursday afternoon', '2026-11-26'], ['thursday in the afternoon', '2026-11-26'], ['monday at 10', '2026-11-30'],
    ['2026-11-26T10:00', '2026-11-26'], ['2026-11-26 10:00', '2026-11-26'], ['wednesday', '2026-11-25'], ['next wednesday', '2026-12-02']
  ])('%j -> %s', (input, want) => expect(date(input)).toBe(want))
  it.each([['Thursday 3 December'], ['2026-02-31'], ['الخميس'], [''], ['thursdayx'], ['whenever']])('does not guess at %j', (input) => expect(date(input)).toBeUndefined())
})

describe('normalizeTime accepts what a language model really sends', () => {
  it.each([
    ['10:30', '10:30'], ['10:30:00', '10:30'], ['10:30.', '10:30'], ['10am', '10:00'], ['10 a.m.', '10:00'], ['2:30 pm', '14:30'], ['2:30 p.m.', '14:30'],
    ['14.30', '14:30'], ['9', '09:00'], ['12am', '00:00'], ['12 pm', '12:00']
  ])('%j -> %s', (input, want) => expect(normalizeTime(input)).toBe(want))
  it.each([['25:00'], ['10:75'], ['ten thirty'], [''], ['10:30:00:00']])('rejects %j', (input) => expect(normalizeTime(input)).toBeUndefined())
})
