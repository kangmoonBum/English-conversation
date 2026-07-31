import type { Rating } from '../types'

const OPTIONS: { value: Rating; emoji: string; label: string; hint: string }[] = [
  { value: 'again', emoji: '😖', label: '다시', hint: '한 단계 쉽게, 내일 다시' },
  { value: 'ok', emoji: '😐', label: '그럭저럭', hint: '같은 단계로 3일 뒤' },
  { value: 'good', emoji: '😀', label: '됐다', hint: '다음 단계로 올라갑니다' },
]

interface Props {
  value?: Rating
  onChange: (rating: Rating) => void
  /** 평가 직후 무슨 일이 일어났는지 — 승급·강등·다음 복습 시점 */
  note?: string | null
}

/**
 * 자기 평가.
 *
 * 자동 채점이 없으므로 이것이 유일한 학습 신호다. 평가 결과가 다음 난이도와
 * 복습 시점을 정하고, 무슨 일이 일어났는지 바로 보여준다 — 아무 반응이 없으면
 * 평가할 이유가 없어진다.
 */
export function SelfRating({ value, onChange, note }: Props) {
  return (
    <div className="rating">
      <div className="rating-main">
        <span className="rating-question">원본과 비교해서 어땠나요?</span>
        <div className="rating-options">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rating-btn ${value === opt.value ? 'rating-btn-on' : ''}`}
              onClick={() => onChange(opt.value)}
              title={opt.hint}
            >
              <span className="rating-emoji">{opt.emoji}</span>
              <span className="rating-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
      {note && <p className="rating-note">{note}</p>}
    </div>
  )
}
