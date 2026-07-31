import type { PracticeLevel, TipLibrary, Turn } from '../types'
import { LEVEL_HINT } from '../srs'
import { HighlightedText } from './HighlightedText'

interface Props {
  turn: Turn
  level: PracticeLevel
  library: TipLibrary
  /** 정답이 공개되었는가. repeat 단계는 항상 true다. */
  revealed: boolean
  activeTip: string | null
  onSelectTip: (ref: string) => void
}

/**
 * 말하기 전에 무엇을 보여줄지, 말한 뒤 무엇을 공개할지를 단계별로 결정한다.
 *
 * 세 단계가 녹음·비교·평가 파이프라인은 전부 공유하고, 달라지는 것은 이 화면뿐이다.
 * 발판(영문 → 키워드 → 한국어 지시)을 한 겹씩 걷어내는 것이 사다리의 전부다.
 */
export function LevelPrompt({ turn, level, library, revealed, activeTip, onSelectTip }: Props) {
  const answer = (
    <>
      <HighlightedText
        text={turn.text}
        tips={turn.tips}
        library={library}
        onSelectTip={onSelectTip}
        activeTip={activeTip}
      />
      <p className="sentence-ko">{turn.ko}</p>
    </>
  )

  if (level === 'repeat') {
    return <div className="prompt">{answer}</div>
  }

  if (level === 'blind') {
    return (
      <div className="prompt">
        {revealed ? (
          answer
        ) : (
          <>
            <p className="prompt-hint">{LEVEL_HINT.blind}</p>
            <div className="keywords">
              {(turn.keywords ?? []).map((kw, i) => (
                <span className="keyword" key={i}>
                  {kw}
                </span>
              ))}
            </div>
            <p className="sentence-ko">{turn.ko}</p>
          </>
        )}
      </div>
    )
  }

  // freestyle — 원본 문장도, 키워드도 보여주지 않는다. 한국어 지시만 준다.
  return (
    <div className="prompt">
      {revealed ? (
        <>
          <div className="alternatives">
            <h4>이렇게 말할 수 있습니다</h4>
            <p className="alternatives-note">
              스크립트와 달라도 틀린 게 아닙니다. 의도가 전달됐다면 성공입니다.
            </p>
            <ul>
              <li className="alternative alternative-script">{turn.text}</li>
              {(turn.alternatives ?? []).map((alt, i) => (
                <li className="alternative" key={i}>
                  {alt}
                </li>
              ))}
            </ul>
          </div>
          {answer}
        </>
      ) : (
        <>
          <p className="prompt-hint">{LEVEL_HINT.freestyle}</p>
          <p className="intent">{turn.intentKo}</p>
        </>
      )}
    </div>
  )
}
