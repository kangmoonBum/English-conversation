import { useState } from 'react'
import type { Tip, TipCategory } from '../types'
import { speakWord } from '../audio/source'

const CATEGORY_LABEL: Record<TipCategory, string> = {
  consonant: '자음',
  vowel: '모음',
  ending: '끝소리',
  cluster: '자음군',
  rhythm: '리듬',
  linking: '연음',
  reduction: '축약',
  intonation: '억양',
}

interface Props {
  id: string
  tip: Tip
  /** 처음 등장하는 팁은 펼쳐서 보여준다. 이후에는 접어 소음을 줄인다. */
  defaultOpen?: boolean
  highlighted?: boolean
}

/**
 * 발음 팁 하나.
 *
 * 이 앱에는 자동 채점이 없다. 대신 `selfCheck`가 그 자리를 대신한다 —
 * 학습자가 몸으로 확인할 수 있는 물리적 검증 방법이라, 점수 없이도
 * 맞게 하고 있는지 스스로 판단할 수 있다. 그래서 시각적으로 가장 강조한다.
 */
export function TipCard({ id, tip, defaultOpen = false, highlighted = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className={`tip tip-${tip.category} ${highlighted ? 'tip-highlighted' : ''}`}
      id={`tip-${id}`}
    >
      <button type="button" className="tip-head" onClick={() => setOpen((v) => !v)}>
        <span className={`tip-badge tip-badge-${tip.category}`}>
          {CATEGORY_LABEL[tip.category]}
        </span>
        <span className="tip-symbol">{tip.symbol}</span>
        <span className="tip-title">{tip.title}</span>
        <span className="tip-toggle">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="tip-body">
          <section className="tip-section">
            <h4>왜 틀리나</h4>
            <p>{tip.why}</p>
          </section>

          <section className="tip-section">
            <h4>어떻게 하나</h4>
            <ol>
              {tip.how.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="tip-section tip-selfcheck">
            <h4>✋ 맞는지 확인하는 법</h4>
            <p>{tip.selfCheck}</p>
          </section>

          {tip.minimalPairs && tip.minimalPairs.length > 0 && (
            <section className="tip-section">
              <h4>구별해서 들어보기</h4>
              <p className="tip-hint">
                들어서 구별이 안 되면 발음도 안 됩니다. 먼저 귀를 여세요.
              </p>
              <div className="pairs">
                {tip.minimalPairs.map((pair, i) => (
                  <div className="pair" key={i}>
                    <button type="button" onClick={() => void speakWord(pair[0])}>
                      🔊 {pair[0]}
                    </button>
                    <span className="pair-vs">vs</span>
                    <button type="button" onClick={() => void speakWord(pair[1])}>
                      🔊 {pair[1]}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
