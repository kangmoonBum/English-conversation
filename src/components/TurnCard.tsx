import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rating, Scenario, Speed, TipLibrary, Turn, TurnProgress } from '../types'
import type { AudioEngine } from '../audio/player'
import { playAba } from '../audio/player'
import type { AudioSource } from '../audio/source'
import { MicPermissionError, Recorder } from '../audio/recorder'
import { loadRecording, saveRecording } from '../store/recordings'
import { sentenceTips } from '../text'
import { HighlightedText } from './HighlightedText'
import { TipCard } from './TipCard'
import { WaveformCompare } from './WaveformCompare'
import { SelfRating } from './SelfRating'

/** 녹음이 무한정 길어지는 것을 막는다. 한 문장 연습에 이보다 오래 걸릴 일은 없다. */
const MAX_RECORDING_MS = 15_000

const RATING_EMOJI: Record<Rating, string> = { again: '😖', ok: '😐', good: '😀' }

type Status = 'idle' | 'playing' | 'recording' | 'comparing'

interface Props {
  scenario: Scenario
  turn: Turn
  library: TipLibrary
  engine: AudioEngine
  source: AudioSource
  recorder: Recorder
  firstAppearing: Set<string>
  isActive: boolean
  onActivate: () => void
  progress?: TurnProgress
  onRate: (rating: Rating) => void
  onAttempt: () => void
  onFallbackDetected: () => void
}

export function TurnCard({
  scenario,
  turn,
  library,
  engine,
  source,
  recorder,
  firstAppearing,
  isActive,
  onActivate,
  progress,
  onRate,
  onAttempt,
  onFallbackDetected,
}: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [original, setOriginal] = useState<AudioBuffer | null>(null)
  const [mine, setMine] = useState<AudioBuffer | null>(null)
  const [activeTip, setActiveTip] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abaSegment, setAbaSegment] = useState<string | null>(null)
  const autoStopTimer = useRef<number | null>(null)

  const isUserTurn = turn.role === scenario.userRole
  const roleName = scenario.roles[turn.role] ?? turn.role

  // 펼쳐질 때 원본 오디오와 이전 녹음을 불러온다.
  // (클릭으로 펼치므로 사용자 제스처 안이고, AudioContext를 안전하게 열 수 있다.)
  useEffect(() => {
    if (!isActive) return
    let cancelled = false

    void (async () => {
      const buffer = await source.buffer(turn, 'normal')
      if (cancelled) return
      setOriginal(buffer)
      if (source.usingFallback) onFallbackDetected()

      const saved = await loadRecording(scenario.id, turn.id)
      if (cancelled || !saved) return
      try {
        setMine(await engine.decodeBlob(saved.blob))
      } catch {
        // 이전 브라우저에서 만든 포맷을 못 읽을 수 있다. 무시하고 새로 녹음하면 된다.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isActive, scenario.id, turn, source, engine, onFallbackDetected])

  const clearAutoStop = () => {
    if (autoStopTimer.current !== null) {
      window.clearTimeout(autoStopTimer.current)
      autoStopTimer.current = null
    }
  }

  useEffect(() => clearAutoStop, [])

  const playOriginal = useCallback(
    async (speed: Speed) => {
      setError(null)
      setStatus('playing')
      try {
        await source.play(turn, speed)
        if (source.usingFallback) onFallbackDetected()
      } finally {
        setStatus('idle')
      }
    },
    [source, turn, onFallbackDetected],
  )

  const stopRecording = useCallback(async () => {
    clearAutoStop()
    try {
      const result = await recorder.stop()
      const buffer = await engine.decodeBlob(result.blob)
      setMine(buffer)
      await saveRecording(scenario.id, turn.id, result.blob, result.mimeType)
      onAttempt()
    } catch (e) {
      setError(e instanceof Error ? e.message : '녹음을 저장하지 못했습니다.')
    } finally {
      setStatus('idle')
    }
  }, [recorder, engine, scenario.id, turn.id, onAttempt])

  const startRecording = useCallback(async () => {
    setError(null)
    engine.stop()
    try {
      await recorder.start()
      setStatus('recording')
      autoStopTimer.current = window.setTimeout(() => void stopRecording(), MAX_RECORDING_MS)
    } catch (e) {
      if (e instanceof MicPermissionError) {
        setError(e.message)
      } else {
        setError(e instanceof Error ? e.message : '녹음을 시작하지 못했습니다.')
      }
      setStatus('idle')
    }
  }, [engine, recorder, stopRecording])

  const playMine = useCallback(async () => {
    if (!mine) return
    setStatus('playing')
    try {
      await engine.play(mine)
    } finally {
      setStatus('idle')
    }
  }, [engine, mine])

  const compare = useCallback(async () => {
    if (!original || !mine) return
    setStatus('comparing')
    try {
      await playAba(engine, original, mine, {
        onSegment: (seg) =>
          setAbaSegment(seg === 'mine' ? '내 녹음' : '원본'),
      })
    } finally {
      setAbaSegment(null)
      setStatus('idle')
    }
  }, [engine, original, mine])

  const busy = status !== 'idle'
  const wholeSentenceTips = sentenceTips(turn.text, turn.tips)

  if (!isActive) {
    return (
      <button type="button" className={`turn turn-collapsed ${isUserTurn ? 'turn-mine' : ''}`} onClick={onActivate}>
        <span className="turn-role">{isUserTurn ? `나 · ${roleName}` : roleName}</span>
        <span className="turn-preview">{turn.text}</span>
        {progress?.rating && <span className="turn-rating">{RATING_EMOJI[progress.rating]}</span>}
      </button>
    )
  }

  return (
    <article className={`turn turn-open ${isUserTurn ? 'turn-mine' : ''}`}>
      <header className="turn-head">
        <span className="turn-role">{isUserTurn ? `나 · ${roleName}` : roleName}</span>
        {progress?.attempts ? <span className="turn-attempts">{progress.attempts}회 연습</span> : null}
      </header>

      <HighlightedText
        text={turn.text}
        tips={turn.tips}
        library={library}
        onSelectTip={setActiveTip}
        activeTip={activeTip}
      />
      <p className="sentence-ko">{turn.ko}</p>

      <div className="controls">
        <button type="button" disabled={busy} onClick={() => void playOriginal('normal')}>
          ▶ 원본
        </button>
        <button type="button" disabled={busy} onClick={() => void playOriginal('slow')}>
          🐢 느리게
        </button>
        {status === 'recording' ? (
          <button type="button" className="btn-recording" onClick={() => void stopRecording()}>
            ⏹ 녹음 멈추기
          </button>
        ) : (
          <button type="button" className="btn-record" disabled={busy} onClick={() => void startRecording()}>
            ⏺ 따라 말하기
          </button>
        )}
      </div>

      {status === 'recording' && (
        <p className="hint hint-recording">듣고 나서 그대로 따라 말해보세요. 최대 15초 후 자동으로 멈춥니다.</p>
      )}
      {error && <p className="error">{error}</p>}

      {mine && (
        <>
          <div className="controls">
            <button type="button" disabled={busy} onClick={() => void playMine()}>
              ▶ 내 녹음
            </button>
            <button
              type="button"
              className="btn-compare"
              disabled={busy || !original}
              onClick={() => void compare()}
              title={original ? undefined : '원본 오디오 파일이 없어 비교 재생을 쓸 수 없습니다'}
            >
              🔁 원본 → 내 녹음 → 원본
            </button>
            {abaSegment && <span className="aba-now">{abaSegment} 재생 중…</span>}
          </div>

          <WaveformCompare original={original} mine={mine} />
          <SelfRating value={progress?.rating} onChange={onRate} />
        </>
      )}

      {(turn.tips?.length ?? 0) > 0 && (
        <section className="tips">
          <h3>발음 유의점</h3>
          {turn.tips!.map((ref) =>
            library[ref.ref] ? (
              <TipCard
                key={ref.ref}
                id={ref.ref}
                tip={library[ref.ref]}
                defaultOpen={firstAppearing.has(ref.ref)}
                highlighted={activeTip === ref.ref}
              />
            ) : null,
          )}
          {wholeSentenceTips.length > 0 && (
            <p className="tips-note">
              위 팁 중 일부는 단어가 아니라 문장 전체에 적용됩니다.
            </p>
          )}
        </section>
      )}

      {turn.coach && (
        <section className="coach">
          <h3>이 문장 노하우</h3>
          <p>{turn.coach}</p>
        </section>
      )}
    </article>
  )
}
