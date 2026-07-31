import { computeNormalizationGain, mixToMono } from './normalize'

/**
 * 재생 엔진.
 *
 * AudioContext는 사용자 제스처 안에서 만들거나 resume해야 한다 (iOS Safari 제약).
 * 그래서 첫 버튼 클릭 시 unlock()을 호출하는 구조로 두었다.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private current: AudioBufferSourceNode | null = null
  /** 정규화 이득 캐시. 같은 버퍼를 반복 재생할 때 매번 전체 샘플을 훑지 않도록. */
  private gainCache = new WeakMap<AudioBuffer, number>()

  /** 사용자 제스처 안에서 호출해야 한다. */
  unlock(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.unlock()
    return ctx.decodeAudioData(data)
  }

  async decodeBlob(blob: Blob): Promise<AudioBuffer> {
    return this.decode(await blob.arrayBuffer())
  }

  /** 이 버퍼를 목표 음량으로 맞추는 이득. 원본과 내 녹음을 나란히 들으려면 필수다. */
  normalizationGain(buffer: AudioBuffer): number {
    const cached = this.gainCache.get(buffer)
    if (cached !== undefined) return cached
    const gain = computeNormalizationGain(mixToMono(buffer))
    this.gainCache.set(buffer, gain)
    return gain
  }

  /**
   * 버퍼를 재생하고, 끝날 때 resolve한다.
   *
   * `rate`는 되도록 쓰지 말 것. playbackRate는 음높이까지 같이 바꿔서
   * 느린 재생이 부자연스럽게 들린다. 느린 버전은 Piper의 --length-scale로
   * 미리 생성한 별도 파일(`audio.slow`)을 쓰는 것이 원칙이고, 이 옵션은
   * 그 파일이 없을 때의 폴백이다.
   */
  play(
    buffer: AudioBuffer,
    opts: { normalize?: boolean; rate?: number } = {},
  ): Promise<void> {
    const ctx = this.unlock()
    this.stop()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = opts.rate ?? 1

    const gainNode = ctx.createGain()
    gainNode.gain.value = opts.normalize === false ? 1 : this.normalizationGain(buffer)

    source.connect(gainNode).connect(ctx.destination)
    this.current = source

    return new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.current === source) this.current = null
        resolve()
      }
      source.start()
    })
  }

  stop(): void {
    if (!this.current) return
    const source = this.current
    this.current = null
    source.onended = null
    try {
      source.stop()
    } catch {
      // 이미 끝난 소스를 멈추면 예외가 나는데, 무시해도 되는 상황이다.
    }
  }

  async close(): Promise<void> {
    this.stop()
    await this.ctx?.close()
    this.ctx = null
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * A/B/A 재생: 원본 → 내 녹음 → 원본.
 *
 * 자동 채점이 없는 이 버전에서 가장 중요한 기능이다. 사람은 자기 발음을
 * 단독으로 들으면 문제를 못 찾지만, 원본 사이에 끼워 들으면 즉시 알아챈다.
 * 사이에 짧은 공백을 두어야 두 소리가 귀에서 분리된다.
 */
export async function playAba(
  engine: AudioEngine,
  original: AudioBuffer,
  mine: AudioBuffer,
  opts: { gapMs?: number; onSegment?: (seg: 'original' | 'mine' | 'original-again') => void } = {},
): Promise<void> {
  const gap = opts.gapMs ?? 350

  opts.onSegment?.('original')
  await engine.play(original)
  await sleep(gap)

  opts.onSegment?.('mine')
  await engine.play(mine)
  await sleep(gap)

  opts.onSegment?.('original-again')
  await engine.play(original)
}
