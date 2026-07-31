import { computeNormalizationGain, mixToMono } from './normalize'

/**
 * 재생 엔진.
 *
 * 모바일 브라우저에는 데스크톱에 없는 제약이 셋 있고, 셋 다 "버튼을 눌렀는데
 * 아무 소리도 안 난다"로 똑같이 나타난다.
 *
 *  1. AudioContext는 사용자 제스처 밖에서 만들면 `suspended` 상태로 시작한다.
 *     이 앱은 파형을 그리려고 화면에 들어오자마자 오디오를 디코드하는데,
 *     그때 컨텍스트가 만들어지므로 항상 이 상태가 된다.
 *  2. `resume()`은 비동기다. 기다리지 않고 바로 `start()`를 부르면 아직 멈춘
 *     컨텍스트에 재생을 걸게 되어 소리가 나지 않는다. (Chrome은 대체로 넘어가지만
 *     iOS Safari는 그대로 무음이 된다.)
 *  3. iOS는 측면 무음 스위치가 켜져 있으면 Web Audio 소리를 통째로 막는다.
 *     Safari 16.4+는 `navigator.audioSession`으로 우회할 수 있다.
 *
 * 그래서 이 클래스는 (a) 첫 사용자 제스처에 오디오를 깨우고, (b) 재생 전에
 * 반드시 resume을 기다리고, (c) 가능하면 재생용 오디오 세션을 요청한다.
 */

/**
 * iOS 무음 스위치 우회.
 *
 * 'playback' 세션은 "이 소리는 사용자가 들으려고 튼 콘텐츠"라는 뜻이라,
 * 벨소리 스위치를 꺼둬도 재생된다. 지원하지 않는 브라우저에서는 조용히 무시된다.
 */
function preferPlaybackSession(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    if (session.type !== 'playback') session.type = 'playback'
  } catch {
    // 일부 브라우저는 읽기 전용이다. 실패해도 재생 자체에는 지장이 없다.
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private current: AudioBufferSourceNode | null = null
  /** iOS는 무음 버퍼를 한 번 재생해줘야 이후 재생이 확실히 난다. */
  private primed = false
  /** 정규화 이득 캐시. 같은 버퍼를 반복 재생할 때 매번 전체 샘플을 훑지 않도록. */
  private gainCache = new WeakMap<AudioBuffer, number>()

  /** 컨텍스트를 만들기만 한다. 제스처 밖에서도 안전하다(만들어지되 suspended). */
  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      preferPlaybackSession()
      this.ctx = new Ctor()
    }
    return this.ctx
  }

  /** 재생을 걸어도 소리가 안 나는 상태인지. UI 안내에 쓴다. */
  get isSuspended(): boolean {
    return this.ctx !== null && this.ctx.state !== 'running'
  }

  /** resume이 끝날 때까지 기다린다. 제스처 밖이면 실패할 수 있으므로 결과를 돌려준다. */
  private async ensureRunning(): Promise<boolean> {
    const ctx = this.context()
    if (ctx.state !== 'running') {
      try {
        await ctx.resume()
      } catch {
        // 사용자 제스처 밖에서는 브라우저가 거부한다. 다음 탭에서 다시 시도된다.
      }
    }
    // resume 이후의 상태를 새로 읽는다.
    return this.context().state === 'running'
  }

  /**
   * 오디오를 깨운다. 반드시 사용자 제스처 안에서 호출되어야 한다.
   * installUnlock()이 문서 전체의 첫 탭에 이걸 걸어준다.
   */
  async unlock(): Promise<boolean> {
    preferPlaybackSession()
    const running = await this.ensureRunning()
    if (running && !this.primed) {
      const ctx = this.context()
      const source = ctx.createBufferSource()
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      source.connect(ctx.destination)
      source.start(0)
      this.primed = true
    }
    return running
  }

  /**
   * 화면 어디를 누르든 첫 제스처에 오디오를 깨운다.
   *
   * 재생 버튼에서만 깨우면 늦다. iOS는 그 시점엔 이미 컨텍스트가 suspended로
   * 만들어져 있어서 첫 재생이 통째로 묻히는 경우가 있다. 그래서 문서 단위로
   * 걸고, 리스너를 떼지 않는다 — 앱을 백그라운드에 보냈다 오면 다시 멈추므로
   * 그 다음 탭에서 또 깨워야 한다.
   *
   * @returns 정리 함수
   */
  installUnlock(): () => void {
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'touchend', 'click', 'keydown']
    const onGesture = () => void this.unlock()
    const onVisible = () => {
      if (!document.hidden) void this.ensureRunning()
    }

    for (const e of events) {
      document.addEventListener(e, onGesture, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      for (const e of events) document.removeEventListener(e, onGesture, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
    }
  }

  /** 디코드는 멈춘 컨텍스트에서도 된다. 여기서 resume을 시도하지 않는다. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.context().decodeAudioData(data)
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
   * 재생 전에 resume을 **기다린다**. 기다리지 않으면 멈춘 컨텍스트에 start()를
   * 걸게 되어 모바일에서 소리가 나지 않는다.
   *
   * `rate`는 되도록 쓰지 말 것. playbackRate는 음높이까지 같이 바꿔서
   * 느린 재생이 부자연스럽게 들린다. 느린 버전은 Piper의 --length-scale로
   * 미리 생성한 별도 파일(`audio.slow`)을 쓰는 것이 원칙이고, 이 옵션은
   * 그 파일이 없을 때의 폴백이다.
   */
  async play(
    buffer: AudioBuffer,
    opts: { normalize?: boolean; rate?: number } = {},
  ): Promise<void> {
    this.stop()

    // 제스처 안에서 호출되는 경로(재생 버튼)라면 여기서 확실히 깨어난다.
    const running = await this.unlock()
    if (!running) {
      // 소리를 낼 수 없는 상태다. 조용히 성공한 척하지 않는다.
      throw new AudioSuspendedError()
    }

    const ctx = this.context()
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
    this.primed = false
  }
}

/** 브라우저가 오디오를 막아 재생하지 못한 경우. UI가 안내를 띄우는 데 쓴다. */
export class AudioSuspendedError extends Error {
  constructor() {
    super(
      '브라우저가 소리를 막고 있습니다. 화면을 한 번 탭한 뒤 다시 눌러주세요. ' +
        'iPhone이라면 측면의 무음(벨소리) 스위치도 확인해주세요.',
    )
    this.name = 'AudioSuspendedError'
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
