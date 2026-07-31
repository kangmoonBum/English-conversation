import type { TipLibrary, TipRef } from '../types'
import { segmentText } from '../text'

interface Props {
  text: string
  tips?: TipRef[]
  library: TipLibrary
  /** 하이라이트를 누르면 해당 팁으로 이동한다 */
  onSelectTip?: (ref: string) => void
  activeTip?: string | null
}

/**
 * 영어 문장을 보여주되, 발음 팁이 걸린 부분을 밑줄로 표시한다.
 * 어디를 조심해야 하는지가 문장 위에서 바로 보여야 한다.
 */
export function HighlightedText({ text, tips, library, onSelectTip, activeTip }: Props) {
  const segments = segmentText(text, tips)

  return (
    <p className="sentence">
      {segments.map((seg, i) =>
        seg.ref && library[seg.ref] ? (
          <button
            key={i}
            type="button"
            className={`marked marked-${library[seg.ref].category} ${
              activeTip === seg.ref ? 'marked-active' : ''
            }`}
            onClick={() => onSelectTip?.(seg.ref!)}
            title={library[seg.ref].title}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  )
}
