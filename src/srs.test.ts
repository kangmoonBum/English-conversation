import { describe, it, expect } from 'vitest'
import {
  schedule,
  maxLevel,
  clampLevel,
  buildQueue,
  pendingCount,
  levelFor,
  INTERVALS,
  INITIAL_LEVEL,
  SESSION_SIZE,
} from './srs'
import type { Progress, Scenario, Turn, TurnProgress } from './types'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** 학습자 턴 — intentKo와 alternatives가 있어 freestyle까지 갈 수 있다. */
const userTurn = (id = 2): Turn => ({
  id,
  role: 'B',
  text: 'Could I get a large iced americano, please?',
  ko: '아이스 아메리카노 라지 하나 주세요.',
  audio: { normal: `${id}.mp3`, slow: `${id}_slow.mp3` },
  keywords: ['large', 'iced americano'],
  intentKo: '아이스 아메리카노 큰 사이즈를 주문해라',
  alternatives: ['Can I have a large iced americano?'],
})

/** 상대역 턴 — intentKo가 없어 blind가 상한이다. */
const partnerTurn = (id = 1): Turn => ({
  id,
  role: 'A',
  text: 'Hi there! What can I get started for you today?',
  ko: '안녕하세요! 오늘 뭐 드릴까요?',
  audio: { normal: `${id}.mp3`, slow: `${id}_slow.mp3` },
  keywords: ['what can I get'],
})

const scenarioOf = (turns: Turn[]): Scenario => ({
  id: 'test-01',
  title: '테스트',
  level: 'A2',
  roles: { A: 'Partner', B: 'Learner' },
  userRole: 'B',
  voices: { A: 'voice-a', B: 'voice-b' },
  turns,
})

const tp = (over: Partial<TurnProgress> = {}): TurnProgress => ({
  level: 'repeat',
  dueAt: NOW,
  rating: 'ok',
  ratedAt: NOW,
  attempts: 1,
  ...over,
})

const progressOf = (entries: Record<number, TurnProgress>): Progress => ({
  version: 2,
  scenarios: {
    'test-01': Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v])),
  },
})

describe('maxLevel', () => {
  it('학습자 턴은 freestyle까지 올라간다', () => {
    expect(maxLevel(userTurn())).toBe('freestyle')
  })

  it('상대역 턴은 blind에서 멈춘다', () => {
    expect(maxLevel(partnerTurn())).toBe('blind')
  })

  it('intentKo만 있고 모범답안이 없으면 freestyle로 올리지 않는다', () => {
    const turn = { ...userTurn(), alternatives: [] }
    expect(maxLevel(turn)).toBe('blind')
  })
})

describe('clampLevel', () => {
  it('상한을 넘는 레벨을 잘라낸다', () => {
    expect(clampLevel('freestyle', partnerTurn())).toBe('blind')
  })

  it('상한 이내면 그대로 둔다', () => {
    expect(clampLevel('blind', userTurn())).toBe('blind')
  })
})

describe('schedule — 😀 됐다', () => {
  it('한 단계 승급하고 곧 다시 확인한다', () => {
    const r = schedule('repeat', 'good', userTurn(), NOW)
    expect(r.level).toBe('blind')
    expect(r.promoted).toBe(true)
    expect(r.dueAt).toBe(NOW + INTERVALS.promoted)
  })

  it('승급 간격은 유지 간격보다 짧다 — 새 난이도를 곧 확인해야 하므로', () => {
    expect(INTERVALS.promoted).toBeLessThan(INTERVALS.ok)
  })

  it('최고 단계에서는 승급하지 않고 길게 쉰다', () => {
    const r = schedule('freestyle', 'good', userTurn(), NOW)
    expect(r.level).toBe('freestyle')
    expect(r.promoted).toBe(false)
    expect(r.mastered).toBe(true)
    expect(r.dueAt).toBe(NOW + INTERVALS.mastered)
  })

  it('상대역 턴은 blind에서 최고 단계 취급한다', () => {
    const r = schedule('blind', 'good', partnerTurn(), NOW)
    expect(r.level).toBe('blind')
    expect(r.mastered).toBe(true)
    expect(r.dueAt).toBe(NOW + INTERVALS.mastered)
  })
})

describe('schedule — 😐 그럭저럭', () => {
  it('단계를 유지하고 중간 간격을 준다', () => {
    const r = schedule('blind', 'ok', userTurn(), NOW)
    expect(r.level).toBe('blind')
    expect(r.promoted).toBe(false)
    expect(r.demoted).toBe(false)
    expect(r.dueAt).toBe(NOW + INTERVALS.ok)
  })
})

describe('schedule — 😖 다시', () => {
  it('한 단계 강등하고 내일 다시 낸다', () => {
    const r = schedule('freestyle', 'again', userTurn(), NOW)
    expect(r.level).toBe('blind')
    expect(r.demoted).toBe(true)
    expect(r.dueAt).toBe(NOW + INTERVALS.again)
  })

  it('최저 단계 아래로는 내려가지 않는다', () => {
    const r = schedule('repeat', 'again', userTurn(), NOW)
    expect(r.level).toBe('repeat')
    expect(r.demoted).toBe(false)
  })
})

describe('schedule — 사다리 왕복', () => {
  it('repeat에서 시작해 세 번 성공하면 freestyle에 도달하고 거기서 멈춘다', () => {
    const turn = userTurn()
    let level = INITIAL_LEVEL
    const seen = [level]
    for (let i = 0; i < 4; i++) {
      level = schedule(level, 'good', turn, NOW).level
      seen.push(level)
    }
    expect(seen).toEqual(['repeat', 'blind', 'freestyle', 'freestyle', 'freestyle'])
  })

  it('데이터가 바뀌어 상한을 넘는 레벨이 저장돼 있어도 안전하게 처리한다', () => {
    // 학습자 턴이 나중에 상대역으로 바뀐 경우 등
    const r = schedule('freestyle', 'ok', partnerTurn(), NOW)
    expect(r.level).toBe('blind')
  })
})

describe('buildQueue', () => {
  const scenario = scenarioOf([partnerTurn(1), userTurn(2), userTurn(3), userTurn(4)])

  it('진행도가 없으면 전부 새 문장으로 시작 단계에서 낸다', () => {
    const queue = buildQueue(scenario, { version: 2, scenarios: {} }, NOW)
    expect(queue).toHaveLength(4)
    expect(queue.every((q) => q.reason === 'new')).toBe(true)
    expect(queue.every((q) => q.level === INITIAL_LEVEL)).toBe(true)
  })

  it('기한이 안 된 문장은 넣지 않는다', () => {
    const progress = progressOf({
      1: tp({ dueAt: NOW + 5 * DAY }),
      2: tp({ dueAt: NOW + 5 * DAY }),
      3: tp({ dueAt: NOW + 5 * DAY }),
      4: tp({ dueAt: NOW + 5 * DAY }),
    })
    expect(buildQueue(scenario, progress, NOW)).toHaveLength(0)
  })

  it('많이 밀린 것부터 낸다', () => {
    const progress = progressOf({
      2: tp({ dueAt: NOW - 1 * DAY }),
      3: tp({ dueAt: NOW - 9 * DAY }),
      4: tp({ dueAt: NOW - 5 * DAY }),
    })
    const queue = buildQueue(scenario, progress, NOW)
    expect(queue.filter((q) => q.reason === 'due').map((q) => q.turn.id)).toEqual([3, 4, 2])
  })

  it('기한이 된 것을 새 문장보다 먼저 낸다', () => {
    const progress = progressOf({ 4: tp({ dueAt: NOW - DAY }) })
    const queue = buildQueue(scenario, progress, NOW)
    expect(queue[0].turn.id).toBe(4)
    expect(queue[0].reason).toBe('due')
    expect(queue.slice(1).every((q) => q.reason === 'new')).toBe(true)
  })

  it('저장된 레벨로 낸다', () => {
    const progress = progressOf({ 2: tp({ level: 'freestyle', dueAt: NOW - DAY }) })
    const queue = buildQueue(scenario, progress, NOW)
    expect(queue[0].level).toBe('freestyle')
  })

  it('저장된 레벨이 상한을 넘으면 잘라서 낸다', () => {
    const progress = progressOf({ 1: tp({ level: 'freestyle', dueAt: NOW - DAY }) })
    const queue = buildQueue(scenario, progress, NOW)
    expect(queue[0].turn.id).toBe(1)
    expect(queue[0].level).toBe('blind')
  })

  it('세션 상한을 넘지 않는다', () => {
    const big = scenarioOf(Array.from({ length: 12 }, (_, i) => userTurn(i + 1)))
    expect(buildQueue(big, { version: 2, scenarios: {} }, NOW)).toHaveLength(SESSION_SIZE)
  })
})

describe('pendingCount', () => {
  it('상한 없이 전체 대기 수를 센다', () => {
    const big = scenarioOf(Array.from({ length: 12 }, (_, i) => userTurn(i + 1)))
    expect(pendingCount(big, { version: 2, scenarios: {} }, NOW)).toBe(12)
  })
})

describe('levelFor', () => {
  it('진행도가 없으면 시작 단계', () => {
    expect(levelFor({ version: 2, scenarios: {} }, 'test-01', userTurn())).toBe(INITIAL_LEVEL)
  })

  it('저장된 단계를 상한에 맞춰 돌려준다', () => {
    const progress = progressOf({ 1: tp({ level: 'freestyle' }) })
    expect(levelFor(progress, 'test-01', partnerTurn(1))).toBe('blind')
  })
})
