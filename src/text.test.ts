import { describe, it, expect } from 'vitest'
import { segmentText, isSentenceLevel, inlineTips, firstAppearances } from './text'
import type { Scenario } from './types'

describe('segmentText', () => {
  it('팁이 없으면 문장 하나를 그대로 돌려준다', () => {
    expect(segmentText('Hello there')).toEqual([{ text: 'Hello there' }])
  })

  it('대상 구간에 ref를 붙여 쪼갠다', () => {
    const segments = segmentText('No room, thanks.', [{ ref: 'r-initial', target: 'room' }])
    expect(segments).toEqual([
      { text: 'No ' },
      { text: 'room', ref: 'r-initial' },
      { text: ', thanks.' },
    ])
  })

  it('여러 팁을 순서대로 처리한다', () => {
    const segments = segmentText('No room, thanks. Just fill it up.', [
      { ref: 'th-voiceless', target: 'thanks' },
      { ref: 'r-initial', target: 'room' },
      { ref: 'linking-cv', target: 'fill it up' },
    ])
    expect(segments.filter((s) => s.ref).map((s) => s.ref)).toEqual([
      'r-initial',
      'th-voiceless',
      'linking-cv',
    ])
    // 원문이 손실 없이 복원되어야 한다.
    expect(segments.map((s) => s.text).join('')).toBe('No room, thanks. Just fill it up.')
  })

  it('문장에 없는 target은 무시한다', () => {
    expect(segmentText('Hello', [{ ref: 'x', target: 'zzz' }])).toEqual([{ text: 'Hello' }])
  })

  it('겹치는 구간은 앞선 것만 남긴다', () => {
    const segments = segmentText('warmed up now', [
      { ref: 'a', target: 'warmed' },
      { ref: 'b', target: 'warmed up' },
    ])
    expect(segments.filter((s) => s.ref).map((s) => s.ref)).toEqual(['a'])
    expect(segments.map((s) => s.text).join('')).toBe('warmed up now')
  })

  it('문장 전체에 걸리는 팁은 인라인으로 칠하지 않는다', () => {
    const text = 'For here or to go?'
    const segments = segmentText(text, [{ ref: 'question-intonation', target: text }])
    expect(segments).toEqual([{ text }])
  })
})

describe('isSentenceLevel', () => {
  it('문장의 절반 이상을 덮으면 문장 단위로 본다', () => {
    expect(isSentenceLevel('Sure. Would you like room?', 'Would you like room?')).toBe(true)
  })

  it('짧은 단어는 인라인으로 본다', () => {
    expect(isSentenceLevel('Sure. Would you like room for cream?', 'room')).toBe(false)
  })

  it('빈 target은 문장 단위가 아니다', () => {
    expect(isSentenceLevel('Hello', '')).toBe(false)
  })
})

describe('inlineTips', () => {
  it('문장 단위 팁을 걸러낸다', () => {
    const text = 'Sure. Would you like room for cream?'
    const tips = [
      { ref: 'r-initial', target: 'room' },
      { ref: 'question-intonation', target: 'Would you like room for cream?' },
    ]
    expect(inlineTips(text, tips).map((t) => t.ref)).toEqual(['r-initial'])
  })
})

describe('firstAppearances', () => {
  const scenario = {
    turns: [
      { id: 1, tips: [{ ref: 'a', target: 'x' }, { ref: 'b', target: 'y' }] },
      { id: 2, tips: [{ ref: 'a', target: 'x' }, { ref: 'c', target: 'z' }] },
      { id: 3, tips: [] },
    ],
  } as unknown as Scenario

  it('각 팁이 처음 나오는 턴에만 표시한다', () => {
    const map = firstAppearances(scenario)
    expect([...(map.get(1) ?? [])].sort()).toEqual(['a', 'b'])
    expect([...(map.get(2) ?? [])]).toEqual(['c'])
    expect([...(map.get(3) ?? [])]).toEqual([])
  })
})
