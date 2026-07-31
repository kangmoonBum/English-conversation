import { describe, it, expect } from 'vitest'
import { migrateProgress } from './progress'
import { INTERVALS, INITIAL_LEVEL } from '../srs'

const NOW = 1_700_000_000_000

describe('migrateProgress — v1 기록 보존', () => {
  const v1 = {
    version: 1,
    scenarios: {
      'cafe-order-01': {
        '2': { rating: 'good', ratedAt: NOW, attempts: 3 },
        '4': { rating: 'again', ratedAt: NOW, attempts: 1 },
      },
    },
  }

  it('기록을 버리지 않는다', () => {
    const out = migrateProgress(v1)
    expect(Object.keys(out.scenarios['cafe-order-01'])).toEqual(['2', '4'])
    expect(out.scenarios['cafe-order-01']['2'].attempts).toBe(3)
    expect(out.scenarios['cafe-order-01']['2'].rating).toBe('good')
  })

  it('버전을 2로 올린다', () => {
    expect(migrateProgress(v1).version).toBe(2)
  })

  it('v1에는 레벨이 없었으므로 시작 단계로 둔다', () => {
    const out = migrateProgress(v1)
    expect(out.scenarios['cafe-order-01']['2'].level).toBe(INITIAL_LEVEL)
  })

  it('기한을 평가 시각 + 등급별 간격으로 되살린다', () => {
    const out = migrateProgress(v1)
    expect(out.scenarios['cafe-order-01']['2'].dueAt).toBe(NOW + INTERVALS.mastered)
    expect(out.scenarios['cafe-order-01']['4'].dueAt).toBe(NOW + INTERVALS.again)
  })
})

describe('migrateProgress — v2 기록', () => {
  it('그대로 통과시킨다', () => {
    const v2 = {
      version: 2,
      scenarios: {
        'cafe-order-01': {
          '2': {
            level: 'freestyle',
            dueAt: NOW + 1000,
            rating: 'good',
            ratedAt: NOW,
            attempts: 5,
          },
        },
      },
    }
    const out = migrateProgress(v2)
    expect(out.scenarios['cafe-order-01']['2']).toEqual({
      level: 'freestyle',
      dueAt: NOW + 1000,
      rating: 'good',
      ratedAt: NOW,
      attempts: 5,
    })
  })
})

describe('migrateProgress — 손상된 입력', () => {
  it.each([
    ['null', null],
    ['문자열', 'nope'],
    ['빈 객체', {}],
    ['scenarios 없음', { version: 2 }],
    ['알 수 없는 버전', { version: 99, scenarios: { a: { '1': {} } } }],
  ])('%s이면 빈 진행도를 돌려준다', (_label, input) => {
    const out = migrateProgress(input)
    expect(out.version).toBe(2)
    expect(out.scenarios).toEqual({})
  })

  it('알 수 없는 레벨 값은 시작 단계로 되돌린다', () => {
    const out = migrateProgress({
      version: 2,
      scenarios: { s: { '1': { level: 'wat', rating: 'ok', ratedAt: NOW, attempts: 1 } } },
    })
    expect(out.scenarios.s['1'].level).toBe(INITIAL_LEVEL)
  })

  it('알 수 없는 등급은 again으로 처리한다', () => {
    const out = migrateProgress({
      version: 2,
      scenarios: { s: { '1': { level: 'blind', rating: 'zzz', ratedAt: NOW, attempts: 1 } } },
    })
    expect(out.scenarios.s['1'].rating).toBe('again')
  })

  it('턴 항목이 전부 망가졌으면 그 시나리오를 넣지 않는다', () => {
    const out = migrateProgress({ version: 2, scenarios: { s: { '1': null, '2': 'x' } } })
    expect(out.scenarios).toEqual({})
  })
})
