import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import scenarioJson from './data/scenarios/cafe-order-01.json'
import tipsJson from './data/pronunciation/tips.json'
import type { Progress, Rating, Scenario, TipLibrary, Turn } from './types'
import { AudioEngine } from './audio/player'
import { AudioSource, WordAudio } from './audio/source'
import { Recorder } from './audio/recorder'
import { loadProgress, getTurnProgress, recordAttempt, recordRating } from './store/progress'
import { purgeExpired } from './store/recordings'
import { firstAppearances } from './text'
import { buildQueue, levelFor, pendingCount, type QueueItem, type ScheduleResult } from './srs'
import { TurnCard } from './components/TurnCard'
import { SessionView } from './components/SessionView'

const scenario = scenarioJson as unknown as Scenario
const library = tipsJson as unknown as TipLibrary

type Tab = 'session' | 'dialogue'

export default function App() {
  const engine = useMemo(() => new AudioEngine(), [])
  const source = useMemo(() => new AudioSource(engine, scenario), [engine])
  const words = useMemo(() => new WordAudio(engine), [engine])
  const recorder = useMemo(() => new Recorder(), [])
  const appearances = useMemo(() => firstAppearances(scenario), [])

  const initialProgress = useMemo(() => loadProgress(), [])
  const [progress, setProgress] = useState<Progress>(initialProgress)
  // 평가는 직전 상태를 동기적으로 읽어야 해서 ref로도 들고 있는다.
  const progressRef = useRef(progress)

  const [tab, setTab] = useState<Tab>('session')
  const [audioMissing, setAudioMissing] = useState(false)

  /**
   * 전체 대화에서 펼쳐둔 문장과 그 단계.
   *
   * 단계를 여기 고정하는 것이 중요하다. 평가 직후 진행도가 바뀌는데, 화면이
   * 그걸 바로 반영하면 "내일 다시"라고 안내해놓고 눈앞에서 난이도가 바뀌어
   * 모순이 된다. 승급은 다음에 이 문장을 열 때부터 적용한다.
   */
  const [active, setActive] = useState(() => {
    const first = scenario.turns[0]
    return { id: first?.id ?? 1, level: levelFor(initialProgress, scenario.id, first) }
  })

  // 세션 큐는 시작 시점에 고정한다 (SessionView 주석 참고).
  const [queue, setQueue] = useState<QueueItem[]>(() =>
    buildQueue(scenario, initialProgress, Date.now()),
  )

  useEffect(() => {
    void purgeExpired()
    return () => {
      recorder.release()
      void engine.close()
    }
  }, [engine, recorder])

  const handleAudioMissing = useCallback(() => setAudioMissing(true), [])

  const handleRate = useCallback((turn: Turn, rating: Rating): ScheduleResult => {
    const { progress: next, result } = recordRating(
      progressRef.current,
      scenario.id,
      turn,
      rating,
    )
    progressRef.current = next
    setProgress(next)
    return result
  }, [])

  const handleAttempt = useCallback((turnId: number) => {
    const next = recordAttempt(progressRef.current, scenario.id, turnId)
    progressRef.current = next
    setProgress(next)
  }, [])

  const restartSession = useCallback(() => {
    setQueue(buildQueue(scenario, progressRef.current, Date.now()))
  }, [])

  const activate = useCallback((turn: Turn) => {
    setActive({ id: turn.id, level: levelFor(progressRef.current, scenario.id, turn) })
  }, [])

  const progressOf = useCallback(
    (turnId: number) => getTurnProgress(progress, scenario.id, turnId),
    [progress],
  )

  const pending = pendingCount(scenario, progress, Date.now())

  const panelDeps = {
    library,
    engine,
    source,
    words,
    recorder,
    onAudioMissing: handleAudioMissing,
  }

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>{scenario.title}</h1>
          <p className="app-sub">
            {scenario.level} · {scenario.turns.length}문장
          </p>
        </div>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={tab === 'session' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('session')}
        >
          오늘의 연습
          {pending > 0 && <span className="tab-badge">{pending}</span>}
        </button>
        <button
          type="button"
          className={tab === 'dialogue' ? 'tab tab-on' : 'tab'}
          onClick={() => setTab('dialogue')}
        >
          전체 대화
        </button>
      </nav>

      {audioMissing && (
        <div className="banner">
          <strong>음성 파일이 없습니다.</strong>
          <span>
            이 앱은 기기 내장 TTS를 쓰지 않습니다. 목소리가 기기마다 달라지면 학습 기준이
            흔들리기 때문입니다. 터미널에서 <code>npm run audio:setup</code> 후{' '}
            <code>npm run audio:build</code>를 실행해 Piper 음성을 만들어주세요.
          </span>
        </div>
      )}

      {tab === 'session' ? (
        <SessionView
          scenario={scenario}
          queue={queue}
          appearances={appearances}
          progressOf={progressOf}
          onRate={handleRate}
          onAttempt={handleAttempt}
          onRestart={restartSession}
          {...panelDeps}
        />
      ) : (
        <>
          <div className="tip-intro">
            점수는 매기지 않습니다. 원본과 내 목소리를 번갈아 들으며 직접 비교하고, 각 문장의{' '}
            <strong>발음 유의점</strong>에 있는 <strong>‘맞는지 확인하는 법’</strong>으로 스스로
            점검하세요. 잘한 문장은 다음에 한 단계 어려워집니다.
          </div>

          <main className="turns">
            {scenario.turns.map((turn) => (
              <TurnCard
                key={turn.id}
                scenario={scenario}
                turn={turn}
                level={
                  turn.id === active.id ? active.level : levelFor(progress, scenario.id, turn)
                }
                firstAppearing={appearances.get(turn.id) ?? new Set()}
                isActive={turn.id === active.id}
                onActivate={() => activate(turn)}
                progress={progressOf(turn.id)}
                onRate={(rating) => handleRate(turn, rating)}
                onAttempt={() => handleAttempt(turn.id)}
                {...panelDeps}
              />
            ))}
          </main>
        </>
      )}

      <footer className="app-foot">
        녹음은 이 브라우저 안에만 저장되며 어디에도 전송되지 않습니다. 7일 후 자동 삭제됩니다.
      </footer>
    </div>
  )
}
