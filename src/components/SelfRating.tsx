import type { Rating } from '../types'

const OPTIONS: { value: Rating; emoji: string; label: string; hint: string }[] = [
  { value: 'again', emoji: '😖', label: '다시', hint: '내일 다시 만납니다' },
  { value: 'ok', emoji: '😐', label: '그럭저럭', hint: '3일 뒤에 다시' },
  { value: 'good', emoji: '😀', label: '됐다', hint: '7일 뒤에 다시' },
]

interface Props {
  value?: Rating
  onChange: (rating: Rating) => void
}

/**
 * 자기 평가.
 *
 * 자동 채점이 없으므로 "내일 뭘 복습할지" 판단할 신호가 이것뿐이다.
 * 초기 버전은 기록만 하고, 실제 복습 큐는 다음 단계에서 이 데이터를 쓴다.
 */
export function SelfRating({ value, onChange }: Props) {
  return (
    <div className="rating">
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
  )
}
