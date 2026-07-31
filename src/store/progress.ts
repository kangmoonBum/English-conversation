import type { Progress, Rating, TurnProgress } from '../types'

/**
 * 진행도 저장 (localStorage).
 *
 * 자동 채점이 없으므로 자기 평가가 유일한 학습 신호다. 초기 버전에서는
 * 기록만 하고, 복습 큐 로직(😖 내일 / 😐 3일 / 😀 7일)은 다음 단계에서 붙인다.
 * 그래서 스키마는 지금부터 ratedAt을 남겨둔다.
 */

const STORAGE_KEY = 'shadowing-trainer.progress.v1'

const empty = (): Progress => ({ version: 1, scenarios: {} })

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Progress
    if (parsed?.version !== 1 || typeof parsed.scenarios !== 'object') return empty()
    return parsed
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

export function recordRating(
  progress: Progress,
  scenarioId: string,
  turnId: number,
  rating: Rating,
): Progress {
  const prev = getTurnProgress(progress, scenarioId, turnId)
  const next: Progress = {
    ...progress,
    scenarios: {
      ...progress.scenarios,
      [scenarioId]: {
        ...progress.scenarios[scenarioId],
        [String(turnId)]: {
          rating,
          ratedAt: Date.now(),
          attempts: prev?.attempts ?? 0,
        },
      },
    },
  }
  save(next)
  return next
}

export function recordAttempt(
  progress: Progress,
  scenarioId: string,
  turnId: number,
): Progress {
  const prev = getTurnProgress(progress, scenarioId, turnId)
  const next: Progress = {
    ...progress,
    scenarios: {
      ...progress.scenarios,
      [scenarioId]: {
        ...progress.scenarios[scenarioId],
        [String(turnId)]: {
          rating: prev?.rating ?? 'again',
          ratedAt: prev?.ratedAt ?? 0,
          attempts: (prev?.attempts ?? 0) + 1,
        },
      },
    },
  }
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
