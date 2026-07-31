import { mixToMono, trimSilence } from './normalize'

/**
 * 파형 표시.
 *
 * 점수를 주지 않는 대신, 원본과 내 녹음의 파형을 나란히 보여준다.
 * 여기서 눈에 보이는 것은 주로 **길이와 쉼의 위치**인데, 사실 이게
 * 초보자에게 가장 큰 문제다 (너무 느리게 말하거나, 엉뚱한 데서 끊거나).
 */

/** 캔버스 폭에 맞춰 샘플을 버킷으로 묶고, 각 버킷의 최대 진폭을 뽑는다. */
export function computePeaks(samples: Float32Array, bucketCount: number): Float32Array {
  const peaks = new Float32Array(bucketCount)
  if (samples.length === 0 || bucketCount === 0) return peaks

  const bucketSize = samples.length / bucketCount
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize)
    const end = Math.min(samples.length, Math.floor((b + 1) * bucketSize))
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    peaks[b] = peak
  }
  return peaks
}

export interface WaveformOptions {
  color: string
  /** 여러 파형의 세로 비율을 맞추기 위한 기준값. 지정하지 않으면 자체 최대치로 맞춘다. */
  normalizeTo?: number
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  samples: Float32Array,
  opts: WaveformOptions,
): void {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth || 300
  const cssHeight = canvas.clientHeight || 56

  canvas.width = Math.floor(cssWidth * dpr)
  canvas.height = Math.floor(cssHeight * dpr)

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const barWidth = 2
  const gap = 1
  const bucketCount = Math.max(1, Math.floor(cssWidth / (barWidth + gap)))
  const peaks = computePeaks(samples, bucketCount)

  let scale = opts.normalizeTo
  if (scale === undefined) {
    scale = peaks.reduce((m, v) => (v > m ? v : m), 0)
  }
  if (!scale || scale <= 0) scale = 1

  const mid = cssHeight / 2
  ctx.fillStyle = opts.color

  for (let i = 0; i < bucketCount; i++) {
    const h = Math.max(1, Math.min(1, peaks[i] / scale) * (cssHeight * 0.9))
    const x = i * (barWidth + gap)
    ctx.fillRect(x, mid - h / 2, barWidth, h)
  }
}

/** AudioBuffer에서 파형용 모노 샘플을 뽑는다. 앞뒤 침묵은 잘라 길이 비교를 정확하게 만든다. */
export function samplesForDisplay(buffer: AudioBuffer): Float32Array {
  return trimSilence(mixToMono(buffer), 0.01, Math.floor(buffer.sampleRate * 0.05))
}

/** 초 단위 길이. 침묵을 제외한 실제 발화 길이를 비교하는 데 쓴다. */
export function spokenDuration(buffer: AudioBuffer): number {
  return samplesForDisplay(buffer).length / buffer.sampleRate
}
