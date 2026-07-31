import type {
  PracticeLevel,
  Rating,
  Scenario,
  TipLibrary,
  Turn,
  TurnProgress,
} from '../types'
import type { AudioEngine } from '../audio/player'
import type { AudioSource } from '../audio/source'
import type { Recorder } from '../audio/recorder'
import type { ScheduleResult } from '../srs'
import { LEVEL_LABEL } from '../srs'
import { PracticePanel } from './PracticePanel'

const RATING_EMOJI: Record<Rating, string> = { again: '😖', ok: '😐', good: '😀' }

interface Props {
  scenario: Scenario
  turn: Turn
  level: PracticeLevel
  library: TipLibrary
  engine: AudioEngine
  source: AudioSource
  recorder: Recorder
  firstAppearing: Set<string>
  isActive: boolean
  onActivate: () => void
  progress?: TurnProgress
  onRate: (rating: Rating) => ScheduleResult
  onAttempt: () => void
  onFallbackDetected: () => void
}

/** 대화 목록의 한 줄. 접혀 있으면 미리보기, 펼치면 연습 화면을 띄운다. */
export function TurnCard({
  scenario,
  turn,
  level,
  isActive,
  onActivate,
  progress,
  ...panelProps
}: Props) {
  const isUserTurn = turn.role === scenario.userRole
  const roleName = scenario.roles[turn.role] ?? turn.role
  const roleLabel = isUserTurn ? `나 · ${roleName}` : roleName

  if (!isActive) {
    return (
      <button
        type="button"
        className={`turn turn-collapsed ${isUserTurn ? 'turn-mine' : ''}`}
        onClick={onActivate}
      >
        <span className="turn-role">{roleLabel}</span>
        <span className="turn-preview">{turn.text}</span>
        {level !== 'repeat' && <span className={`level-dot level-${level}`} />}
        {progress?.rating && <span className="turn-rating">{RATING_EMOJI[progress.rating]}</span>}
      </button>
    )
  }

  return (
    <article className={`turn turn-open ${isUserTurn ? 'turn-mine' : ''}`}>
      <header className="turn-head">
        <span className="turn-role">{roleLabel}</span>
        <span className="turn-meta">
          <span className={`level-badge level-${level}`}>{LEVEL_LABEL[level]}</span>
          {progress?.attempts ? <span className="turn-attempts">{progress.attempts}회</span> : null}
        </span>
      </header>

      <PracticePanel
        scenario={scenario}
        turn={turn}
        level={level}
        progress={progress}
        {...panelProps}
      />
    </article>
  )
}
