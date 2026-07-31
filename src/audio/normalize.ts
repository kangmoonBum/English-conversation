/**
 * 음량 정규화.
 *
 * 발음을 있는 그대로 들으려고 브라우저의 자동 음량 조절(AGC)을 꺼두기 때문에
 * (recorder.ts 참고), 학습자의 녹음은 원본 TTS보다 훨씬 작게 녹음된다.
 * 그 상태로 A/B 비교를 하면 "내 발음이 나쁘다"가 아니라 "내 소리가 작다"로만
 * 들려서 비교가 무의미해진다. 그래서 재생 시점에 양쪽 음량을 맞춰준다.
 *
 * 순수 함수만 두어 Node 환경에서 테스트한다.
 */

/** 목표 RMS. 약 -20 dBFS로, 말소리에 적당한 수준이다. */
export const TARGET_RMS = 0.1

/** 클리핑 방지 상한. 이득을 걸어도 피크가 이 값을 넘지 않게 한다. */
export const MAX_PEAK = 0.99

/** 제곱평균제곱근 — 체감 음량에 가장 가까운 지표다. */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

/** 절댓값 최대치. 이득을 걸었을 때 소리가 깨지는지 판단하는 데 쓴다. */
export function computePeak(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  return peak
}

/**
 * 목표 RMS에 맞추는 이득을 구한다.
 * 단, 그 이득 때문에 피크가 MAX_PEAK를 넘으면 클리핑을 피하려고 이득을 낮춘다.
 * (음량을 정확히 맞추는 것보다 소리가 깨지지 않는 게 중요하다.)
 */
export function computeNormalizationGain(
  samples: Float32Array,
  targetRms: number = TARGET_RMS,
  maxPeak: number = MAX_PEAK,
): number {
  const rms = computeRms(samples)
  if (rms === 0) return 1

  let gain = targetRms / rms
  const peak = computePeak(samples)
  if (peak > 0 && peak * gain > maxPeak) {
    gain = maxPeak / peak
  }
  return gain
}

/**
 * 무음 구간을 잘라낸다.
 * 녹음 버튼을 누르고 머뭇거린 앞뒤 침묵이 파형 비교를 크게 왜곡하기 때문에,
 * 파형을 그리기 전에 적용한다.
 *
 * @param threshold 이 진폭 이하를 무음으로 본다
 * @param padding 잘라낸 뒤 앞뒤로 남겨둘 샘플 수 (자연스러운 시작/끝을 위해)
 */
export function trimSilence(
  samples: Float32Array,
  threshold = 0.01,
  padding = 0,
): Float32Array {
  let start = 0
  let end = samples.length - 1

  while (start < samples.length && Math.abs(samples[start]) < threshold) start++
  while (end > start && Math.abs(samples[end]) < threshold) end--

  // 전부 무음이면 원본을 그대로 돌려준다 (빈 배열을 넘기면 이후 계산이 깨진다).
  // start === end 는 유효 구간이 한 샘플인 정상 케이스이므로 여기서 걸러내면 안 된다.
  if (start > end) return samples

  start = Math.max(0, start - padding)
  end = Math.min(samples.length - 1, end + padding)
  return samples.slice(start, end + 1)
}

/**
 * 여러 채널을 하나로 합친다. 파형 표시와 RMS 계산은 모노 기준으로 한다.
 * (AudioBuffer는 DOM 타입이라 여기서는 최소한의 형태만 받는다.)
 */
export interface MultiChannelSamples {
  numberOfChannels: number
  length: number
  getChannelData(channel: number): Float32Array
}

export function mixToMono(buffer: MultiChannelSamples): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0)
  }
  const out = new Float32Array(buffer.length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < out.length; i++) out[i] += data[i]
  }
  for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels
  return out
}
