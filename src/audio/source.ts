import type { Scenario, Speed, Turn } from '../types'
import type { AudioEngine } from './player'

/**
 * 원본 음성의 출처를 추상화한다.
 *
 * 기본 경로는 Piper로 미리 생성해 커밋한 mp3다. 하지만 Piper 음성 모델은
 * HuggingFace에서 받아야 하고 이 저장소에는 오디오가 없는 상태로 시작하므로,
 * 파일이 없으면 브라우저 내장 TTS로 자동 폴백한다.
 *
 * 폴백은 소리만 낼 수 있고 AudioBuffer를 얻을 수 없어서(브라우저 내장 TTS는
 * 파일로 캡처가 불가능하다) 파형 비교와 A/B/A 재생이 제한된다. 그래서
 * 폴백이 켜지면 UI에 배너를 띄워 `npm run audio:build`를 안내한다.
 */

export type SourceKind = 'file' | 'speech'

export interface ResolvedAudio {
  kind: SourceKind
  /** kind가 'file'일 때만 존재한다. */
  buffer: AudioBuffer | null
}

function audioUrl(scenarioId: string, file: string): string {
  return `${import.meta.env.BASE_URL}audio/${scenarioId}/${file}`
}

/**
 * 시나리오는 .mp3로 파일명을 적지만, 생성 시 ffmpeg가 없으면 .wav가 만들어진다.
 * 둘 다 시도해서 ffmpeg 설치를 선택 사항으로 남긴다.
 */
function candidateUrls(scenarioId: string, file: string): string[] {
  const stem = file.replace(/\.[^.]+$/, '')
  const alt = file.endsWith('.wav') ? `${stem}.mp3` : `${stem}.wav`
  return [audioUrl(scenarioId, file), audioUrl(scenarioId, alt)]
}

export class AudioSource {
  private cache = new Map<string, ResolvedAudio>()
  /** 한 번이라도 파일이 없어서 폴백했는지 — 배너 표시에 쓴다. */
  private sawMissingFile = false

  constructor(
    private engine: AudioEngine,
    private scenario: Scenario,
  ) {}

  get usingFallback(): boolean {
    return this.sawMissingFile
  }

  private key(turn: Turn, speed: Speed): string {
    return `${turn.id}:${speed}`
  }

  /** 파일을 가져와 디코드한다. 없으면 kind: 'speech'로 표시해 폴백을 알린다. */
  async resolve(turn: Turn, speed: Speed): Promise<ResolvedAudio> {
    const key = this.key(turn, speed)
    const cached = this.cache.get(key)
    if (cached) return cached

    const file = turn.audio?.[speed]
    let result: ResolvedAudio = { kind: 'speech', buffer: null }

    if (file) {
      for (const url of candidateUrls(this.scenario.id, file)) {
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          // 개발 서버는 없는 정적 파일에 index.html을 돌려주기도 하므로
          // 상태 코드만 믿지 않고 디코드 성공 여부까지 확인한다.
          const buffer = await this.engine.decode(await res.arrayBuffer())
          result = { kind: 'file', buffer }
          break
        } catch {
          // 404이거나 디코드 실패 — 다음 후보, 없으면 폴백으로 넘어간다.
        }
      }
    }

    if (result.kind === 'speech') this.sawMissingFile = true
    this.cache.set(key, result)
    return result
  }

  /**
   * 원본을 재생한다. 파일이 있으면 정규화해서 재생하고, 없으면 브라우저 TTS로 읽는다.
   */
  async play(turn: Turn, speed: Speed): Promise<void> {
    const resolved = await this.resolve(turn, speed)
    if (resolved.kind === 'file' && resolved.buffer) {
      await this.engine.play(resolved.buffer)
      return
    }
    await speakWithBrowserTts(turn.text, speed === 'slow' ? 0.7 : 0.95)
  }

  /** 파형 비교용 버퍼. 폴백 중이면 null이다. */
  async buffer(turn: Turn, speed: Speed): Promise<AudioBuffer | null> {
    return (await this.resolve(turn, speed)).buffer
  }
}

/**
 * 브라우저 내장 TTS. 파일로 저장할 수 없어 임시 수단으로만 쓴다.
 * 목소리는 OS·브라우저마다 다르고 품질도 들쭉날쭉하다.
 */
export function speakWithBrowserTts(text: string, rate = 0.95): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof speechSynthesis === 'undefined') {
      resolve()
      return
    }
    speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = rate

    const enVoice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'))
    if (enVoice) utterance.voice = enVoice

    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    speechSynthesis.speak(utterance)
  })
}

/** 최소 대립쌍처럼 오디오 파일이 없는 단어를 읽어줄 때 쓴다. */
export function speakWord(word: string): Promise<void> {
  return speakWithBrowserTts(word, 0.8)
}
