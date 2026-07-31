import type { Scenario, TipRef } from './types'

/**
 * 문장을 팁 대상 구간으로 쪼갠다.
 *
 * 발음 팁이 문장의 어느 부분에 걸리는지 눈에 보여야 "이 단어를 조심하라"가
 * 전달된다. 그래서 text를 하이라이트 구간과 일반 구간으로 나눈다.
 */
export interface TextSegment {
  text: string
  /** 하이라이트 구간이면 해당 팁의 id */
  ref?: string
}

/**
 * 문장 전체(또는 대부분)에 걸리는 팁은 인라인 하이라이트로 표시하지 않는다.
 * 억양·리듬처럼 발화 전체에 적용되는 팁이 여기 해당하며, 문장을 통째로
 * 칠해버리면 정작 중요한 개별 단어 표시를 덮어쓴다.
 */
const SENTENCE_LEVEL_RATIO = 0.5

export function isSentenceLevel(text: string, target: string): boolean {
  if (!target) return false
  return target.length / text.length >= SENTENCE_LEVEL_RATIO
}

/** 인라인 하이라이트 대상만 남긴다. */
export function inlineTips(text: string, tips: TipRef[] = []): TipRef[] {
  return tips.filter((t) => !isSentenceLevel(text, t.target))
}

/** 문장 전체에 걸리는 팁만 남긴다. */
export function sentenceTips(text: string, tips: TipRef[] = []): TipRef[] {
  return tips.filter((t) => isSentenceLevel(text, t.target))
}

export function segmentText(text: string, tips: TipRef[] = []): TextSegment[] {
  const marks: { start: number; end: number; ref: string }[] = []

  for (const tip of inlineTips(text, tips)) {
    const start = text.indexOf(tip.target)
    if (start < 0) continue
    marks.push({ start, end: start + tip.target.length, ref: tip.ref })
  }

  // 시작이 이른 것 우선, 같으면 짧은 것(더 구체적인 것) 우선.
  marks.sort((a, b) => a.start - b.start || a.end - b.end)

  const segments: TextSegment[] = []
  let cursor = 0

  for (const mark of marks) {
    // 앞 구간과 겹치면 건너뛴다. 겹치는 target은 validate 스크립트가 경고한다.
    if (mark.start < cursor) continue
    if (mark.start > cursor) {
      segments.push({ text: text.slice(cursor, mark.start) })
    }
    segments.push({ text: text.slice(mark.start, mark.end), ref: mark.ref })
    cursor = mark.end
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }
  return segments
}

/**
 * 각 팁이 대화에서 "처음 등장하는" 턴을 찾는다.
 *
 * 팁 카드를 매번 펼쳐두면 금세 소음이 되고 학습자가 읽지 않게 된다.
 * 처음 나올 때만 펼치고 이후에는 접어둔다.
 */
export function firstAppearances(scenario: Scenario): Map<number, Set<string>> {
  const seen = new Set<string>()
  const result = new Map<number, Set<string>>()

  for (const turn of scenario.turns) {
    const fresh = new Set<string>()
    for (const tip of turn.tips ?? []) {
      if (!seen.has(tip.ref)) {
        seen.add(tip.ref)
        fresh.add(tip.ref)
      }
    }
    result.set(turn.id, fresh)
  }
  return result
}
