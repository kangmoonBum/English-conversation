import { useCallback, useEffect, useMemo, useState } from 'react'
import scenarioJson from './data/scenarios/cafe-order-01.json'
import tipsJson from './data/pronunciation/tips.json'
import type { Progress, Rating, Scenario, TipLibrary } from './types'
import { AudioEngine } from './audio/player'
import { AudioSource } from './audio/source'
import { Recorder } from './audio/recorder'
import { loadProgress, getTurnProgress, recordAttempt, recordRating } from './store/progress'
import { purgeExpired } from './store/recordings'
import { firstAppearances } from './text'
import { TurnCard } from './components/TurnCard'

const scenario = scenarioJson as unknown as Scenario
const library = tipsJson as unknown as TipLibrary

export default function App() {
  const engine = useMemo(() => new AudioEngine(), [])
  const source = useMemo(() => new AudioSource(engine, scenario), [engine])
  const recorder = useMemo(() => new Recorder(), [])
  const appearances = useMemo(() => firstAppearances(scenario), [])

  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [activeTurnId, setActiveTurnId] = useState<number>(scenario.turns[0]?.id ?? 1)
  const [usingFallback, setUsingFallback] = useState(false)

  useEffect(() => {
    void purgeExpired()
    return () => {
      recorder.release()
      void engine.close()
    }
  }, [engine, recorder])

  const handleFallback = useCallback(() => setUsingFallback(true), [])

  const handleRate = useCallback(
    (turnId: number, rating: Rating) =>
      setProgress((p) => recordRating(p, scenario.id, turnId, rating)),
    [],
  )

  const handleAttempt = useCallback(
    (turnId: number) => setProgress((p) => recordAttempt(p, scenario.id, turnId)),
    [],
  )

  const practiced = scenario.turns.filter(
    (t) => (getTurnProgress(progress, scenario.id, t.id)?.attempts ?? 0) > 0,
  ).length

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>{scenario.title}</h1>
          <p className="app-sub">
            {scenario.level} · {scenario.turns.length}문장 · 따라 말하기 연습
          </p>
        </div>
        <div className="app-progress">
          {practiced} / {scenario.turns.length}
        </div>
      </header>

      {usingFallback && (
        <div className="banner">
          <strong>임시 음성으로 재생 중입니다.</strong>
          <span>
            Piper 음성 파일이 아직 없어 브라우저 내장 TTS로 읽고 있습니다. 음질이 낮고
            파형·비교 재생을 쓸 수 없습니다. 터미널에서{' '}
            <code>npm run audio:setup</code> 후 <code>npm run audio:build</code>를 실행하세요.
          </span>
        </div>
      )}

      <div className="tip-intro">
        점수는 매기지 않습니다. 원본과 내 목소리를 번갈아 들으며 직접 비교하고,
        각 문장의 <strong>발음 유의점</strong>에 있는 <strong>‘맞는지 확인하는 법’</strong>으로
        스스로 점검하세요.
      </div>

      <main className="turns">
        {scenario.turns.map((turn) => (
          <TurnCard
            key={turn.id}
            scenario={scenario}
            turn={turn}
            library={library}
            engine={engine}
            source={source}
            recorder={recorder}
            firstAppearing={appearances.get(turn.id) ?? new Set()}
            isActive={turn.id === activeTurnId}
            onActivate={() => setActiveTurnId(turn.id)}
            progress={getTurnProgress(progress, scenario.id, turn.id)}
            onRate={(rating) => handleRate(turn.id, rating)}
            onAttempt={() => handleAttempt(turn.id)}
            onFallbackDetected={handleFallback}
          />
        ))}
      </main>

      <footer className="app-foot">
        녹음은 이 브라우저 안에만 저장되며 어디에도 전송되지 않습니다. 7일 후 자동 삭제됩니다.
      </footer>
    </div>
  )
}
