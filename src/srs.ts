import type { PracticeLevel, Progress, Rating, Scenario, Turn, TurnProgress } from './types'

/**
 * 복습 스케줄링.
 *
 * 이 앱에는 자동 채점이 없으므로 자기 평가(😖/😐/😀)가 유일한 학습 신호다.
 * 그 신호를 단순한 반복 간격이 아니라 **난이도 사다리**에 연결한다.
 * 잘했다고 평가하면 다음번에 발판을 하나 걷어내고, 막혔다고 하면 발판을 다시 대준다.
 *
 * 전부 순수 함수라 UI 없이 테스트할 수 있다.
 */

/** 쉬운 것부터 순서대로. 인덱스가 곧 난이도다. */
export const LEVELS: PracticeLevel[] = ['repeat', 'blind', 'freestyle']

export const LEVEL_LABEL: Record<PracticeLevel, string> = {
  repeat: '따라 말하기',
  blind: '키워드만 보고',
  freestyle: '자유롭게 말하기',
}

export const LEVEL_HINT: Record<PracticeLevel, string> = {
  repeat: '영문을 보면서 들은 대로 따라 말합니다',
  blind: '영문 없이 키워드만 보고, 들은 소리를 복원합니다',
  freestyle: '한국어 지시만 보고 스스로 문장을 만듭니다',
}

export const INITIAL_LEVEL: PracticeLevel = 'repeat'

const DAY = 24 * 60 * 60 * 1000

/**
 * 복습 간격.
 *
 * 승급했을 때 간격이 짧은 것이 의도적이다 — 난이도가 올라갔으니 잘 되는지
 * 곧 다시 확인해야 한다. 최고 단계에서 성공했을 때만 길게 쉰다.
 */
export const INTERVALS = {
  again: 1 * DAY,
  ok: 3 * DAY,
  promoted: 1 * DAY,
  mastered: 7 * DAY,
} as const

/**
 * 이 문장이 올라갈 수 있는 최고 단계.
 *
 * 상대역 대사에는 `intentKo`/`alternatives`가 없다 — 학습자가 만들어낼 문장이
 * 아니기 때문이다. 그래서 freestyle까지 올라가지 않고 blind에서 멈춘다.
 */
export function maxLevel(turn: Turn): PracticeLevel {
  const canFreestyle = Boolean(turn.intentKo) && (turn.alternatives?.length ?? 0) > 0
  return canFreestyle ? 'freestyle' : 'blind'
}

export function levelIndex(level: PracticeLevel): number {
  const i = LEVELS.indexOf(level)
  return i < 0 ? 0 : i
}

/** 상한을 넘지 않게 자른다. 시나리오 데이터가 바뀌어도 안전하게 동작하도록. */
export function clampLevel(level: PracticeLevel, turn: Turn): PracticeLevel {
  const cap = levelIndex(maxLevel(turn))
  return LEVELS[Math.min(levelIndex(level), cap)]
}

export interface ScheduleResult {
  level: PracticeLevel
  dueAt: number
  promoted: boolean
  demoted: boolean
  /** 최고 단계에서 성공해 긴 간격으로 넘어간 경우 */
  mastered: boolean
}

/**
 * 평가를 받아 다음 단계와 복습 기한을 정한다.
 *
 *   😀 됐다      → 한 단계 승급, 1일 뒤 (최고 단계면 그대로, 7일 뒤)
 *   😐 그럭저럭  → 단계 유지, 3일 뒤
 *   😖 다시      → 한 단계 강등(최저 repeat), 1일 뒤
 */
export function schedule(
  current: PracticeLevel,
  rating: Rating,
  turn: Turn,
  now: number,
): ScheduleResult {
  const from = levelIndex(clampLevel(current, turn))
  const cap = levelIndex(maxLevel(turn))

  if (rating === 'good') {
    if (from >= cap) {
      return {
        level: LEVELS[cap],
        dueAt: now + INTERVALS.mastered,
        promoted: false,
        demoted: false,
        mastered: true,
      }
    }
    return {
      level: LEVELS[from + 1],
      dueAt: now + INTERVALS.promoted,
      promoted: true,
      demoted: false,
      mastered: false,
    }
  }

  if (rating === 'ok') {
    return {
      level: LEVELS[from],
      dueAt: now + INTERVALS.ok,
      promoted: false,
      demoted: false,
      mastered: false,
    }
  }

  // 'again' — 막혔으면 발판을 다시 대준다. 계속 실패하는 단계를 붙들고 있는 것보다 낫다.
  const to = Math.max(0, from - 1)
  return {
    level: LEVELS[to],
    dueAt: now + INTERVALS.again,
    promoted: false,
    demoted: to < from,
    mastered: false,
  }
}

/** 평가 직후 사용자에게 보여줄 한 줄 설명. */
export function describeSchedule(result: ScheduleResult): string {
  const when = formatInterval(result.dueAt - Date.now())
  if (result.promoted) {
    return `다음엔 '${LEVEL_LABEL[result.level]}' 단계로 · ${when}`
  }
  if (result.demoted) {
    return `'${LEVEL_LABEL[result.level]}' 단계로 돌아갑니다 · ${when}`
  }
  if (result.mastered) {
    return `이 문장은 충분합니다 · ${when}`
  }
  return `같은 단계로 한 번 더 · ${when}`
}

function formatInterval(ms: number): string {
  const days = Math.round(ms / DAY)
  if (days <= 1) return '내일 다시'
  return `${days}일 뒤 다시`
}

// ---------- 복습 큐 ----------

export type QueueReason = 'due' | 'new'

export interface QueueItem {
  /** 여러 상황을 한 세션에서 섞어 내므로 각 항목이 자기 시나리오를 들고 다닌다. */
  scenario: Scenario
  turn: Turn
  level: PracticeLevel
  progress?: TurnProgress
  reason: QueueReason
}

/** 세션 하나의 상한. 5분 안에 끝나야 매일 열게 된다. */
export const SESSION_SIZE = 5

function turnProgress(
  progress: Progress,
  scenarioId: string,
  turnId: number,
): TurnProgress | undefined {
  return progress.scenarios[scenarioId]?.[String(turnId)]
}

/**
 * 오늘 연습할 문장을 고른다.
 *
 * 여러 상황을 한 세션에 섞어서 낸다. 복습은 "어느 대화였는지"가 아니라
 * "언제 다시 볼 때가 됐는지"로 정해져야 하고, 실전에서도 상황은 예고 없이 온다.
 *
 * 기한이 지난 것을 먼저(많이 밀린 순서대로), 그다음 아직 해보지 않은 것을
 * 대화 순서대로 채운다. 아직 기한이 안 된 문장은 넣지 않는다 —
 * 세션이 짧게 끝나는 편이 안 여는 것보다 낫다.
 */
export function buildQueue(
  scenarios: Scenario[],
  progress: Progress,
  now: number,
  limit: number = SESSION_SIZE,
): QueueItem[] {
  const due: QueueItem[] = []
  const fresh: QueueItem[] = []

  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      const tp = turnProgress(progress, scenario.id, turn.id)

      if (!tp) {
        fresh.push({ scenario, turn, level: INITIAL_LEVEL, progress: undefined, reason: 'new' })
        continue
      }
      if (tp.dueAt <= now) {
        due.push({
          scenario,
          turn,
          level: clampLevel(tp.level, turn),
          progress: tp,
          reason: 'due',
        })
      }
    }
  }

  // 많이 밀린 것부터
  due.sort((a, b) => (a.progress!.dueAt ?? 0) - (b.progress!.dueAt ?? 0))

  return [...due, ...fresh].slice(0, limit)
}

/** 탭 배지에 쓸 개수. limit를 걸지 않은 전체 대기 수다. */
export function pendingCount(scenarios: Scenario[], progress: Progress, now: number): number {
  return buildQueue(scenarios, progress, now, Number.MAX_SAFE_INTEGER).length
}

/** 이 문장을 지금 어느 단계로 낼지. 진행도가 없으면 시작 단계. */
export function levelFor(
  progress: Progress,
  scenarioId: string,
  turn: Turn,
): PracticeLevel {
  const tp = turnProgress(progress, scenarioId, turn.id)
  return tp ? clampLevel(tp.level, turn) : INITIAL_LEVEL
}
