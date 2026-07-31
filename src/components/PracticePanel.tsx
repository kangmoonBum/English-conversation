import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PracticeLevel,
  Rating,
  Scenario,
  Speed,
  TipLibrary,
  Turn,
  TurnProgress,
} from '../types'
import type { AudioEngine } from '../audio/player'
import { playAba, sleep } from '../audio/player'
import type { AudioSource, WordAudio } from '../audio/source'
import { MicPermissionError, Recorder } from '../audio/recorder'
import { loadRecording, saveRecording } from '../store/recordings'
import type { ScheduleResult } from '../srs'
import { describeSchedule } from '../srs'
import { LevelPrompt } from './LevelPrompt'
import { TipCard } from './TipCard'
import { WaveformCompare } from './WaveformCompare'
import { SelfRating } from './SelfRating'

/** 녹음이 무한정 길어지는 것을 막는다. 한 문장 연습에 이보다 오래 걸릴 일은 없다. */
const MAX_RECORDING_MS = 15_000

/** 오버랩 재생이 끝난 뒤 녹음을 조금 더 붙잡아 두는 시간 (말끝이 잘리지 않도록). */
const OVERLAP_TAIL_MS = 500

type Status = 'idle' | 'playing' | 'recording' | 'comparing'

interface Props {
  scenario: Scenario
  turn: Turn
  level: PracticeLevel
  library: TipLibrary
  engine: AudioEngine
  source: AudioSource
  words: WordAudio
  recorder: Recorder
  firstAppearing: Set<string>
  progress?: TurnProgress
  onRate: (rating: Rating) => ScheduleResult
  onAttempt: () => void
  onAudioMissing: () => void
}

/**
 * 한 문장을 연습하는 화면.
 *
 * 세 단계(repeat / blind / freestyle)가 이 컴포넌트를 공유한다.
 * 녹음 → 음량 정규화 → A/B/A 비교 → 파형 → 자기 평가 파이프라인은 동일하고,
 * 말하기 전에 무엇을 보여주는지만 LevelPrompt가 바꾼다.
 */
export function PracticePanel({
  scenario,
  turn,
  level,
  library,
  engine,
  source,
  words,
  recorder,
  firstAppearing,
  progress,
  onRate,
  onAttempt,
  onAudioMissing,
}: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [original, setOriginal] = useState<AudioBuffer | null>(null)
  const [mine, setMine] = useState<AudioBuffer | null>(null)
  const [activeTip, setActiveTip] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abaSegment, setAbaSegment] = useState<string | null>(null)
  const [overlap, setOverlap] = useState(false)
  const [scheduleNote, setScheduleNote] = useState<string | null>(null)

  // repeat 단계는 애초에 영문이 보이므로 늘 공개 상태다.
  const [revealed, setRevealed] = useState(level === 'repeat')

  const autoStopTimer = useRef<number | null>(null)

  // 단계나 문장이 바뀌면 공개 상태와 이전 녹음을 초기화한다.
  useEffect(() => {
    setRevealed(level === 'repeat')
    setMine(null)
    setScheduleNote(null)
    setError(null)
    setOverlap(false)
  }, [level, turn.id])

  // freestyle에서는 정답을 공개하기 전까지 원본을 들려주지 않는다 — 답을 알려주는 셈이 되므로.
  const canPlayOriginal = level !== 'freestyle' || revealed

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const buffer = await source.buffer(turn, 'normal')
      if (cancelled) return
      setOriginal(buffer)
      if (source.hasMissingAudio) onAudioMissing()

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
  }, [scenario.id, turn, source, engine, onAudioMissing])

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
        const played = await source.play(turn, speed)
        if (!played) {
          onAudioMissing()
          setError('이 문장의 음성 파일이 없습니다. `npm run audio:build`를 실행하세요.')
        }
      } finally {
        setStatus('idle')
      }
    },
    [source, turn, onAudioMissing],
  )

  const stopRecording = useCallback(async () => {
    clearAutoStop()
    try {
      const result = await recorder.stop()
      const buffer = await engine.decodeBlob(result.blob)
      setMine(buffer)
      await saveRecording(scenario.id, turn.id, result.blob, result.mimeType)
      onAttempt()
      // 말하고 나면 바로 답을 확인하고 싶어진다. 굳이 한 번 더 누르게 하지 않는다.
      setRevealed(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '녹음을 저장하지 못했습니다.')
    } finally {
      setStatus('idle')
    }
  }, [recorder, engine, scenario.id, turn.id, onAttempt])

  const startRecording = useCallback(async () => {
    setError(null)
    setScheduleNote(null)
    engine.stop()
    try {
      await recorder.start()
      setStatus('recording')
      autoStopTimer.current = window.setTimeout(() => void stopRecording(), MAX_RECORDING_MS)
    } catch (e) {
      setError(
        e instanceof MicPermissionError
          ? e.message
          : e instanceof Error
            ? e.message
            : '녹음을 시작하지 못했습니다.',
      )
      setStatus('idle')
    }
  }, [engine, recorder, stopRecording])

  /**
   * 오버랩(동시 섀도잉) — 원본을 들으면서 겹쳐 말한다.
   * 재생이 끝나면 자동으로 녹음을 멈춘다.
   */
  const startOverlap = useCallback(async () => {
    setError(null)
    setScheduleNote(null)
    try {
      await recorder.start()
      setStatus('recording')
      await source.play(turn, 'normal')
      await sleep(OVERLAP_TAIL_MS)
      await stopRecording()
    } catch (e) {
      setError(
        e instanceof MicPermissionError
          ? e.message
          : e instanceof Error
            ? e.message
            : '녹음을 시작하지 못했습니다.',
      )
      setStatus('idle')
    }
  }, [recorder, source, turn, stopRecording])

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
        onSegment: (seg) => setAbaSegment(seg === 'mine' ? '내 녹음' : '원본'),
      })
    } finally {
      setAbaSegment(null)
      setStatus('idle')
    }
  }, [engine, original, mine])

  const handleRate = useCallback(
    (rating: Rating) => setScheduleNote(describeSchedule(onRate(rating))),
    [onRate],
  )

  const toggleOverlap = () => {
    setOverlap((v) => !v)
    setMine(null)
    setScheduleNote(null)
  }

  const busy = status !== 'idle'
  const recordLabel = level === 'freestyle' ? '⏺ 말해보기' : '⏺ 따라 말하기'

  return (
    <>
      <LevelPrompt
        turn={turn}
        level={level}
        library={library}
        revealed={revealed}
        activeTip={activeTip}
        onSelectTip={setActiveTip}
      />

      <div className="controls">
        {canPlayOriginal && (
          <>
            <button type="button" disabled={busy} onClick={() => void playOriginal('normal')}>
              ▶ 원본
            </button>
            <button type="button" disabled={busy} onClick={() => void playOriginal('slow')}>
              🐢 느리게
            </button>
          </>
        )}

        {status === 'recording' ? (
          <button
            type="button"
            className="btn-recording"
            disabled={overlap}
            onClick={() => void stopRecording()}
            title={overlap ? '재생이 끝나면 자동으로 멈춥니다' : undefined}
          >
            {overlap ? '⏺ 겹쳐 말하는 중…' : '⏹ 녹음 멈추기'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-record"
            disabled={busy}
            onClick={() => void (overlap ? startOverlap() : startRecording())}
          >
            {overlap ? '⏺ 겹쳐 말하기' : recordLabel}
          </button>
        )}

        {!revealed && status !== 'recording' && (
          <button type="button" className="btn-reveal" onClick={() => setRevealed(true)}>
            정답 보기
          </button>
        )}
      </div>

      {level === 'repeat' && (
        <label className="overlap-toggle">
          <input type="checkbox" checked={overlap} onChange={toggleOverlap} disabled={busy} />
          <span>오버랩 — 원본을 들으면서 동시에 말하기</span>
        </label>
      )}

      {overlap && (
        <p className="hint hint-warn">
          <strong>헤드폰을 쓰세요.</strong> 스피커로 하면 마이크가 원본 소리까지 같이
          녹음해서 비교가 무의미해집니다. 그래서 오버랩은 연습 전용이고 비교·평가를 하지 않습니다.
        </p>
      )}

      {status === 'recording' && !overlap && (
        <p className="hint hint-recording">최대 15초 후 자동으로 멈춥니다.</p>
      )}
      {error && <p className="error">{error}</p>}

      {/*
        정답을 공개하기 전에는 이전 녹음을 꺼내 보여주지 않는다.
        freestyle에서 A/B/A 비교 버튼이 보이면 그걸 눌러 원본을 들을 수 있고,
        그건 말해보기도 전에 답을 알려주는 셈이다.
      */}
      {revealed && mine && (
        <>
          <div className="controls">
            <button type="button" disabled={busy} onClick={() => void playMine()}>
              ▶ 내 녹음
            </button>
            {!overlap && (
              <button
                type="button"
                className="btn-compare"
                disabled={busy || !original}
                onClick={() => void compare()}
                title={original ? undefined : '원본 오디오 파일이 없어 비교 재생을 쓸 수 없습니다'}
              >
                🔁 원본 → 내 녹음 → 원본
              </button>
            )}
            {abaSegment && <span className="aba-now">{abaSegment} 재생 중…</span>}
          </div>

          {!overlap && (
            <>
              <WaveformCompare original={original} mine={mine} />
              <SelfRating value={progress?.rating} onChange={handleRate} note={scheduleNote} />
            </>
          )}
        </>
      )}

      {revealed && (turn.tips?.length ?? 0) > 0 && (
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
                onPlayWord={(word) => words.play(word)}
              />
            ) : null,
          )}
        </section>
      )}

      {revealed && turn.coach && (
        <section className="coach">
          <h3>이 문장 노하우</h3>
          <p>{turn.coach}</p>
        </section>
      )}
    </>
  )
}
