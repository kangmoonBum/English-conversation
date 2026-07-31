import { describe, it, expect } from 'vitest'
import {
  computeRms,
  computePeak,
  computeNormalizationGain,
  trimSilence,
  mixToMono,
  TARGET_RMS,
  MAX_PEAK,
} from './normalize'

/** 진폭 amp인 사인파를 만든다. 사인파의 RMS는 amp/√2 로 알려져 있어 검증에 좋다. */
function sine(amp: number, length = 4096, cycles = 16): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * cycles * i) / length)
  }
  return out
}

describe('computeRms', () => {
  it('빈 입력은 0을 반환한다', () => {
    expect(computeRms(new Float32Array(0))).toBe(0)
  })

  it('무음은 0을 반환한다', () => {
    expect(computeRms(new Float32Array(1000))).toBe(0)
  })

  it('사인파의 RMS는 진폭/√2 이다', () => {
    expect(computeRms(sine(1))).toBeCloseTo(1 / Math.SQRT2, 3)
    expect(computeRms(sine(0.5))).toBeCloseTo(0.5 / Math.SQRT2, 3)
  })

  it('직류 신호의 RMS는 진폭과 같다', () => {
    expect(computeRms(new Float32Array(100).fill(0.3))).toBeCloseTo(0.3, 5)
  })
})

describe('computePeak', () => {
  it('음수 진폭도 절댓값으로 잡는다', () => {
    expect(computePeak(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8)
  })

  it('빈 입력은 0을 반환한다', () => {
    expect(computePeak(new Float32Array(0))).toBe(0)
  })
})

describe('computeNormalizationGain', () => {
  it('작게 녹음된 신호를 목표 음량까지 키운다', () => {
    const quiet = sine(0.02)
    const gain = computeNormalizationGain(quiet)
    expect(computeRms(quiet) * gain).toBeCloseTo(TARGET_RMS, 4)
    expect(gain).toBeGreaterThan(1)
  })

  it('큰 신호는 줄인다', () => {
    const loud = sine(0.9)
    const gain = computeNormalizationGain(loud)
    expect(gain).toBeLessThan(1)
    expect(computeRms(loud) * gain).toBeCloseTo(TARGET_RMS, 4)
  })

  it('클리핑이 생길 이득은 피크 기준으로 낮춘다', () => {
    // 피크는 크지만 RMS는 아주 작은 신호 — 그대로 이득을 걸면 소리가 깨진다.
    const spiky = new Float32Array(10000)
    spiky[0] = 0.95
    const gain = computeNormalizationGain(spiky)
    expect(computePeak(spiky) * gain).toBeLessThanOrEqual(MAX_PEAK + 1e-6)
  })

  it('무음에는 이득을 걸지 않는다 (0으로 나누기 방지)', () => {
    expect(computeNormalizationGain(new Float32Array(100))).toBe(1)
  })
})

describe('trimSilence', () => {
  it('앞뒤 무음을 잘라낸다', () => {
    const s = new Float32Array([0, 0, 0, 0.5, -0.4, 0.6, 0, 0, 0])
    // Float32 정밀도 때문에 기댓값도 같은 표현으로 맞춰서 비교한다.
    expect(Array.from(trimSilence(s))).toEqual(Array.from(new Float32Array([0.5, -0.4, 0.6])))
  })

  it('전부 무음이면 원본을 그대로 돌려준다', () => {
    const s = new Float32Array(50)
    expect(trimSilence(s).length).toBe(50)
  })

  it('padding만큼 앞뒤를 남긴다', () => {
    const s = new Float32Array([0, 0, 0, 0.5, 0, 0, 0])
    expect(trimSilence(s, 0.01, 1).length).toBe(3)
  })

  it('임계값 이하의 잡음은 무음으로 본다', () => {
    const s = new Float32Array([0.001, 0.002, 0.9, 0.001])
    expect(Array.from(trimSilence(s, 0.01))).toEqual(Array.from(new Float32Array([0.9])))
  })

  it('유효 구간이 한 샘플뿐이어도 무음으로 오판하지 않는다', () => {
    const s = new Float32Array([0, 0, 0.8, 0, 0])
    expect(Array.from(trimSilence(s, 0.01))).toEqual(Array.from(new Float32Array([0.8])))
  })
})

describe('mixToMono', () => {
  it('모노는 그대로 통과시킨다', () => {
    const data = new Float32Array([0.1, 0.2])
    const buf = { numberOfChannels: 1, length: 2, getChannelData: () => data }
    expect(mixToMono(buf)).toBe(data)
  })

  it('스테레오는 평균을 낸다', () => {
    const left = new Float32Array([1, 0])
    const right = new Float32Array([0, 1])
    const buf = {
      numberOfChannels: 2,
      length: 2,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    }
    expect(Array.from(mixToMono(buf))).toEqual([0.5, 0.5])
  })
})
