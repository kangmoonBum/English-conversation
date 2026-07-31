import { useState } from 'react'
import type { Rating, TipLibrary, Turn, TurnProgress } from '../types'
import type { AudioEngine } from '../audio/player'
import type { AudioSource, WordAudio } from '../audio/source'
import type { Recorder } from '../audio/recorder'
import type { QueueItem, ScheduleResult } from '../srs'
import { LEVEL_LABEL } from '../srs'
import { PracticePanel } from './PracticePanel'

interface Props {
  queue: QueueItem[]
  library: TipLibrary
  engine: AudioEngine
  source: AudioSource
  words: WordAudio
  recorder: Recorder
  appearancesFor: (scenarioId: string, turnId: number) => Set<string>
  progressOf: (scenarioId: string, turnId: number) => TurnProgress | undefined
  onRate: (scenarioId: string, turn: Turn, rating: Rating) => ScheduleResult
  onAttempt: (scenarioId: string, turnId: number) => void
  onAudioMissing: () => void
  onRestart: () => void
}

/**
 * 오늘의 연습.
 *
 * 복습 큐에서 뽑은 문장을 한 번에 하나씩, 각자의 단계로 진행한다.
 * 여러 상황이 섞여 나오므로 문장마다 어느 대화인지 함께 보여준다.
 * 5분 안에 끝나야 매일 열게 되므로 한 세션은 최대 5문장이다.
 *
 * 큐는 세션 시작 시점에 고정된다. 평가할 때마다 다시 계산하면 방금 평가한 문장이
 * 기한이 미뤄져 목록에서 사라지고, 진행 중인 세션이 눈앞에서 줄어든다.
 */
export function SessionView({
  queue,
  appearancesFor,
  progressOf,
  onRate,
  onAttempt,
  onRestart,
  ...panelProps
}: Props) {
  const [index, setIndex] = useState(0)

  if (queue.length === 0) {
    return (
      <div className="session-empty">
        <p className="session-empty-title">오늘 복습할 문장이 없습니다.</p>
        <p className="session-empty-body">
          기한이 된 문장이 생기면 여기 나타납니다. 지금 더 하고 싶다면
          <strong> 전체 대화</strong> 탭에서 아무 문장이나 골라 연습하세요.
        </p>
      </div>
    )
  }

  const done = index >= queue.length
  if (done) {
    return (
      <div className="session-empty">
        <p className="session-empty-title">오늘 몫을 끝냈습니다. 👏</p>
        <p className="session-empty-body">
          평가한 문장은 각자의 기한에 다시 나타납니다. 잘한 문장은 다음에 한 단계
          어려워집니다.
        </p>
        <button type="button" className="btn-primary" onClick={onRestart}>
          한 세트 더 하기
        </button>
      </div>
    )
  }

  const item = queue[index]
  const { scenario, turn } = item
  const isLast = index >= queue.length - 1
  const isUserTurn = turn.role === scenario.userRole
  const roleName = scenario.roles[turn.role] ?? turn.role

  return (
    <div className="session">
      <div className="session-bar">
        <span className="session-count">
          {index + 1} / {queue.length}
        </span>
        <div className="session-dots">
          {queue.map((q, i) => (
            <span
              key={`${q.scenario.id}:${q.turn.id}`}
              className={`session-dot ${i === index ? 'session-dot-on' : ''} ${
                i < index ? 'session-dot-done' : ''
              }`}
            />
          ))}
        </div>
        <span className={`level-badge level-${item.level}`}>{LEVEL_LABEL[item.level]}</span>
      </div>

      <article className={`turn turn-open ${isUserTurn ? 'turn-mine' : ''}`}>
        <header className="turn-head">
          <span className="turn-role">
            {/* 여러 상황이 섞여 나오므로 어느 대화인지 먼저 알려준다. */}
            <span className="turn-scenario">{scenario.title}</span>
            {isUserTurn ? `나 · ${roleName}` : roleName}
          </span>
          <span className="turn-meta">
            <span className="turn-attempts">{item.reason === 'new' ? '처음' : '복습'}</span>
          </span>
        </header>

        <PracticePanel
          // 문장이 바뀌면 연습 상태를 완전히 새로 시작한다.
          key={`${scenario.id}:${turn.id}:${item.level}`}
          scenario={scenario}
          turn={turn}
          level={item.level}
          firstAppearing={appearancesFor(scenario.id, turn.id)}
          progress={progressOf(scenario.id, turn.id)}
          onRate={(rating) => onRate(scenario.id, turn, rating)}
          onAttempt={() => onAttempt(scenario.id, turn.id)}
          {...panelProps}
        />
      </article>

      <div className="session-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          ← 이전
        </button>
        <button type="button" className="btn-primary" onClick={() => setIndex((i) => i + 1)}>
          {isLast ? '세션 끝내기' : '다음 →'}
        </button>
      </div>
    </div>
  )
}
