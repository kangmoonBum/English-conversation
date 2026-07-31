import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import tipsJson from './data/pronunciation/tips.json'
import { SCENARIOS } from './data/scenarios'
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

const library = tipsJson as unknown as TipLibrary

type Tab = 'session' | 'dialogue'

/** 시나리오별 "이 팁이 처음 나오는 턴" 표. 팁 카드를 언제 펼칠지 정하는 데 쓴다. */
const APPEARANCES = new Map(SCENARIOS.map((s) => [s.id, firstAppearances(s)]))
const appearancesFor = (scenarioId: string, turnId: number) =>
  APPEARANCES.get(scenarioId)?.get(turnId) ?? new Set<string>()

export default function App() {
  const engine = useMemo(() => new AudioEngine(), [])
  const source = useMemo(() => new AudioSource(engine), [engine])
  const words = useMemo(() => new WordAudio(engine), [engine])
  const recorder = useMemo(() => new Recorder(), [])

  const initialProgress = useMemo(() => loadProgress(), [])
  const [progress, setProgress] = useState<Progress>(initialProgress)
  // 평가는 직전 상태를 동기적으로 읽어야 해서 ref로도 들고 있는다.
  const progressRef = useRef(progress)

  const [tab, setTab] = useState<Tab>('session')
  const [audioMissing, setAudioMissing] = useState(false)

  /** 전체 대화 탭에서 보고 있는 상황. */
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]

  /**
   * 펼쳐둔 문장과 그 단계.
   *
   * 단계를 여기 고정하는 것이 중요하다. 평가 직후 진행도가 바뀌는데, 화면이
   * 그걸 바로 반영하면 "내일 다시"라고 안내해놓고 눈앞에서 난이도가 바뀌어
   * 모순이 된다. 승급은 다음에 이 문장을 열 때부터 적용한다.
   */
  const [active, setActive] = useState(() => {
    const first = SCENARIOS[0].turns[0]
    return {
      scenarioId: SCENARIOS[0].id,
      id: first.id,
      level: levelFor(initialProgress, SCENARIOS[0].id, first),
    }
  })

  // 세션 큐는 시작 시점에 고정한다 (SessionView 주석 참고).
  const [queue, setQueue] = useState<QueueItem[]>(() =>
    buildQueue(SCENARIOS, initialProgress, Date.now()),
  )
  // 세션을 다시 뽑을 때 SessionView를 새로 마운트시키는 용도.
  // 이게 없으면 큐만 바뀌고 진행 위치(index)가 남아 완료 화면에서 벗어나지 못한다.
  const [sessionId, setSessionId] = useState(0)

  useEffect(() => {
    void purgeExpired()
    // 모바일은 사용자가 화면을 한 번 만지기 전까지 소리를 내주지 않는다.
    // 재생 버튼에서만 깨우면 늦으므로 문서 전체의 첫 제스처에 걸어둔다.
    const removeUnlock = engine.installUnlock()
    return () => {
      removeUnlock()
      recorder.release()
      void engine.close()
    }
  }, [engine, recorder])

  const handleAudioMissing = useCallback(() => setAudioMissing(true), [])

  const handleRate = useCallback(
    (sid: string, turn: Turn, rating: Rating): ScheduleResult => {
      const { progress: next, result } = recordRating(progressRef.current, sid, turn, rating)
      progressRef.current = next
      setProgress(next)
      return result
    },
    [],
  )

  const handleAttempt = useCallback((sid: string, turnId: number) => {
    const next = recordAttempt(progressRef.current, sid, turnId)
    progressRef.current = next
    setProgress(next)
  }, [])

  const restartSession = useCallback(() => {
    setQueue(buildQueue(SCENARIOS, progressRef.current, Date.now()))
    setSessionId((n) => n + 1)
  }, [])

  const activate = useCallback((s: Scenario, turn: Turn) => {
    setActive({
      scenarioId: s.id,
      id: turn.id,
      level: levelFor(progressRef.current, s.id, turn),
    })
  }, [])

  const selectScenario = useCallback((s: Scenario) => {
    setScenarioId(s.id)
    const first = s.turns[0]
    setActive({ scenarioId: s.id, id: first.id, level: levelFor(progressRef.current, s.id, first) })
  }, [])

  const pending = pendingCount(SCENARIOS, progress, Date.now())

  /** 이 상황에서 한 번이라도 연습한 문장 수 */
  const practicedIn = (s: Scenario) =>
    s.turns.filter((t) => (getTurnProgress(progress, s.id, t.id)?.attempts ?? 0) > 0).length

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
          <h1>섀도잉 트레이너</h1>
          <p className="app-sub">
            상황 {SCENARIOS.length}개 · 문장{' '}
            {SCENARIOS.reduce((n, s) => n + s.turns.length, 0)}개
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
          key={sessionId}
          queue={queue}
          appearancesFor={appearancesFor}
          progressOf={(sid, turnId) => getTurnProgress(progress, sid, turnId)}
          onRate={handleRate}
          onAttempt={handleAttempt}
          onRestart={restartSession}
          {...panelDeps}
        />
      ) : (
        <>
          <div className="scenario-picker">
            {SCENARIOS.map((s) => {
              const done = practicedIn(s)
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`scenario-chip ${s.id === scenario.id ? 'scenario-chip-on' : ''}`}
                  onClick={() => selectScenario(s)}
                >
                  <span className="scenario-title">{s.title}</span>
                  <span className="scenario-meta">
                    {s.level} · {done}/{s.turns.length}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="tip-intro">
            점수는 매기지 않습니다. 원본과 내 목소리를 번갈아 들으며 직접 비교하고, 각 문장의{' '}
            <strong>발음 유의점</strong>에 있는 <strong>‘맞는지 확인하는 법’</strong>으로 스스로
            점검하세요. 잘한 문장은 다음에 한 단계 어려워집니다.
          </div>

          <main className="turns">
            {scenario.turns.map((turn) => {
              const isActive = active.scenarioId === scenario.id && active.id === turn.id
              return (
                <TurnCard
                  key={`${scenario.id}:${turn.id}`}
                  scenario={scenario}
                  turn={turn}
                  level={isActive ? active.level : levelFor(progress, scenario.id, turn)}
                  firstAppearing={appearancesFor(scenario.id, turn.id)}
                  isActive={isActive}
                  onActivate={() => activate(scenario, turn)}
                  progress={getTurnProgress(progress, scenario.id, turn.id)}
                  onRate={(rating) => handleRate(scenario.id, turn, rating)}
                  onAttempt={() => handleAttempt(scenario.id, turn.id)}
                  {...panelDeps}
                />
              )
            })}
          </main>
        </>
      )}

      <footer className="app-foot">
        녹음은 이 브라우저 안에만 저장되며 어디에도 전송되지 않습니다. 7일 후 자동 삭제됩니다.
      </footer>
    </div>
  )
}
