import type { PracticeLevel, Progress, Rating, Turn, TurnProgress } from '../types'
import { INITIAL_LEVEL, INTERVALS, LEVELS, schedule, type ScheduleResult } from '../srs'

/**
 * 진행도 저장 (localStorage).
 *
 * 자동 채점이 없으므로 자기 평가가 유일한 학습 신호다. 그 신호는 여기 저장되고
 * srs.ts가 다음 난이도와 복습 기한을 정한다.
 */

// 키 문자열은 바꾸지 않는다. 바꾸면 기존 사용자의 기록이 통째로 사라진다.
// 버전 관리는 저장된 객체의 `version` 필드로 한다.
const STORAGE_KEY = 'shadowing-trainer.progress.v1'

const empty = (): Progress => ({ version: 2, scenarios: {} })

const isLevel = (v: unknown): v is PracticeLevel =>
  typeof v === 'string' && (LEVELS as string[]).includes(v)

const isRating = (v: unknown): v is Rating =>
  v === 'again' || v === 'ok' || v === 'good'

/** 등급별 기본 간격. v1 기록에는 기한이 없어서 평가 시각을 기준으로 되살린다. */
function intervalFor(rating: Rating): number {
  if (rating === 'good') return INTERVALS.mastered
  if (rating === 'ok') return INTERVALS.ok
  return INTERVALS.again
}

/**
 * 저장된 데이터를 현재 스키마로 옮긴다.
 *
 * v1에는 level과 dueAt이 없었다. 기록을 버리지 않고 되살리는 것이 중요하다 —
 * 며칠치 연습 기록이 조용히 사라지면 다시 안 열게 된다.
 * v1 사용자는 전부 repeat 단계에서 연습하고 있었으므로 그 단계를 유지한다.
 *
 * 순수 함수라 localStorage 없이 테스트할 수 있다.
 */
export function migrateProgress(raw: unknown): Progress {
  if (!raw || typeof raw !== 'object') return empty()
  const source = raw as { version?: unknown; scenarios?: unknown }
  if (typeof source.scenarios !== 'object' || source.scenarios === null) return empty()

  const version = source.version
  if (version !== 1 && version !== 2) return empty()

  const out: Progress = empty()

  for (const [scenarioId, turns] of Object.entries(source.scenarios as Record<string, unknown>)) {
    if (!turns || typeof turns !== 'object') continue
    const migratedTurns: Record<string, TurnProgress> = {}

    for (const [turnId, value] of Object.entries(turns as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const entry = value as Partial<TurnProgress>

      const rating = isRating(entry.rating) ? entry.rating : 'again'
      const ratedAt = typeof entry.ratedAt === 'number' ? entry.ratedAt : 0
      const attempts = typeof entry.attempts === 'number' ? entry.attempts : 0

      migratedTurns[turnId] = {
        level: isLevel(entry.level) ? entry.level : INITIAL_LEVEL,
        // v2 기록이면 dueAt을 그대로, v1이면 평가 시각 + 등급별 간격으로 되살린다.
        dueAt:
          typeof entry.dueAt === 'number'
            ? entry.dueAt
            : ratedAt > 0
              ? ratedAt + intervalFor(rating)
              : 0,
        rating,
        ratedAt,
        attempts,
      }
    }

    if (Object.keys(migratedTurns).length > 0) {
      out.scenarios[scenarioId] = migratedTurns
    }
  }

  return out
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    return migrateProgress(JSON.parse(raw))
  } catch {
    // 손상된 데이터 때문에 앱이 못 뜨는 것이 훨씬 나쁘다.
    return empty()
  }
}

function save(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 저장 실패(용량 초과·프라이빗 모드)로 연습을 막지는 않는다.
  }
}

export function getTurnProgress(
  progress: Progress,
  scenarioId: string,
  turnId: number,
): TurnProgress | undefined {
  return progress.scenarios[scenarioId]?.[String(turnId)]
}

function withTurn(
  progress: Progress,
  scenarioId: string,
  turnId: number,
  next: TurnProgress,
): Progress {
  return {
    ...progress,
    scenarios: {
      ...progress.scenarios,
      [scenarioId]: {
        ...progress.scenarios[scenarioId],
        [String(turnId)]: next,
      },
    },
  }
}

/**
 * 자기 평가를 기록하고 다음 단계·복습 기한을 정한다.
 *
 * 승급 여부를 함께 돌려주는 이유는, 사용자에게 "다음엔 키워드만 보고 해봅니다"처럼
 * 무슨 일이 일어났는지 바로 보여주기 위해서다. 아무 반응이 없으면 평가할 이유가 없다.
 */
export function recordRating(
  progress: Progress,
  scenarioId: string,
  turn: Turn,
  rating: Rating,
  now: number = Date.now(),
): { progress: Progress; result: ScheduleResult } {
  const prev = getTurnProgress(progress, scenarioId, turn.id)
  const result = schedule(prev?.level ?? INITIAL_LEVEL, rating, turn, now)

  const next = withTurn(progress, scenarioId, turn.id, {
    level: result.level,
    dueAt: result.dueAt,
    rating,
    ratedAt: now,
    attempts: prev?.attempts ?? 0,
  })

  save(next)
  return { progress: next, result }
}

export function recordAttempt(
  progress: Progress,
  scenarioId: string,
  turnId: number,
  now: number = Date.now(),
): Progress {
  const prev = getTurnProgress(progress, scenarioId, turnId)

  const next = withTurn(progress, scenarioId, turnId, {
    level: prev?.level ?? INITIAL_LEVEL,
    // 아직 평가하지 않았으면 기한을 지금으로 둔다 — 오늘의 연습에 계속 남아 있어야 한다.
    dueAt: prev?.dueAt ?? now,
    rating: prev?.rating ?? 'again',
    ratedAt: prev?.ratedAt ?? 0,
    attempts: (prev?.attempts ?? 0) + 1,
  })

  save(next)
  return next
}

export function clearProgress(): Progress {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 무시
  }
  return empty()
}
