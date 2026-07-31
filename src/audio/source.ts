import type { Scenario, Speed, Turn } from '../types'
import type { AudioEngine } from './player'

/**
 * 원본 음성의 출처.
 *
 * 모든 음성은 Piper로 미리 생성해 저장소에 커밋한 파일이다
 * (`npm run audio:build`). 런타임에 합성하지 않는다.
 *
 * 브라우저 내장 TTS(speechSynthesis)는 쓰지 않는다. OS·브라우저마다 목소리가
 * 달라 학습 기준이 흔들리고, 기계적인 음색이라 그걸 따라 하면 어색한 발음이
 * 굳는다. 파일이 없으면 소리를 내는 대신 UI에서 그 사실을 알린다.
 */

export type SourceKind = 'file' | 'missing'

export interface ResolvedAudio {
  kind: SourceKind
  /** kind가 'file'일 때만 존재한다. */
  buffer: AudioBuffer | null
}

const MISSING: ResolvedAudio = { kind: 'missing', buffer: null }

/**
 * 시나리오는 .mp3로 파일명을 적지만, 생성 시 ffmpeg가 없으면 .wav가 만들어진다.
 * 둘 다 시도해서 ffmpeg 설치를 선택 사항으로 남긴다.
 */
function candidateUrls(dir: string, file: string): string[] {
  const stem = file.replace(/\.[^.]+$/, '')
  const base = `${import.meta.env.BASE_URL}audio/${dir}/`
  return [`${base}${file}`, `${base}${stem}${file.endsWith('.wav') ? '.mp3' : '.wav'}`]
}

/** 후보 URL을 차례로 시도해 디코드한다. 전부 실패하면 null. */
async function fetchBuffer(engine: AudioEngine, urls: string[]): Promise<AudioBuffer | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      // 개발 서버는 없는 정적 파일에 index.html을 돌려주기도 하므로
      // 상태 코드만 믿지 않고 디코드 성공 여부까지 확인한다.
      return await engine.decode(await res.arrayBuffer())
    } catch {
      // 404이거나 디코드 실패 — 다음 후보로.
    }
  }
  return null
}

export class AudioSource {
  private cache = new Map<string, ResolvedAudio>()
  /** 한 번이라도 파일이 없었는지 — 안내 배너 표시에 쓴다. */
  private sawMissingFile = false

  constructor(
    private engine: AudioEngine,
    private scenario: Scenario,
  ) {}

  get hasMissingAudio(): boolean {
    return this.sawMissingFile
  }

  async resolve(turn: Turn, speed: Speed): Promise<ResolvedAudio> {
    const key = `${turn.id}:${speed}`
    const cached = this.cache.get(key)
    if (cached) return cached

    const file = turn.audio?.[speed]
    const buffer = file
      ? await fetchBuffer(this.engine, candidateUrls(this.scenario.id, file))
      : null

    const result: ResolvedAudio = buffer ? { kind: 'file', buffer } : MISSING
    if (!buffer) this.sawMissingFile = true
    this.cache.set(key, result)
    return result
  }

  /** 원본을 재생한다. 파일이 없으면 아무 소리도 내지 않고 false를 돌려준다. */
  async play(turn: Turn, speed: Speed): Promise<boolean> {
    const resolved = await this.resolve(turn, speed)
    if (resolved.kind !== 'file' || !resolved.buffer) return false
    await this.engine.play(resolved.buffer)
    return true
  }

  /** 파형 비교용 버퍼. 파일이 없으면 null이다. */
  async buffer(turn: Turn, speed: Speed): Promise<AudioBuffer | null> {
    return (await this.resolve(turn, speed)).buffer
  }
}

/**
 * 단어 → 파일명.
 * scripts/generate-audio.mjs의 wordSlug와 같은 규칙이다.
 * 한쪽만 고치면 조용히 404가 되므로 함께 고쳐야 한다.
 */
export function wordSlug(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * 최소 대립쌍 단어 재생.
 *
 * 팁 카드에서 right/light 같은 쌍을 눌러 들을 때 쓴다. 이 단어들도
 * `npm run audio:build`가 22050Hz로 미리 생성한다 — 마찰음 차이를 들어야
 * 하는데 저품질 음성으로는 그 구별 자체가 불가능하기 때문이다.
 */
export class WordAudio {
  private cache = new Map<string, AudioBuffer | null>()

  constructor(private engine: AudioEngine) {}

  async play(word: string): Promise<boolean> {
    const slug = wordSlug(word)
    let buffer = this.cache.get(slug)

    if (buffer === undefined) {
      buffer = await fetchBuffer(this.engine, candidateUrls('_words', `${slug}.mp3`))
      this.cache.set(slug, buffer)
    }

    if (!buffer) return false
    await this.engine.play(buffer)
    return true
  }
}
