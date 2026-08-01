import type { WeekProgress } from '../srs'
import { LEVEL_LABEL, WEEK_UNLOCK_RATIO } from '../srs'

interface Props {
  weeks: WeekProgress[]
}

/**
 * 주차별 진도율 막대.
 *
 * "몇 문장을 건드려봤는가"가 아니라 **"어디까지 올라왔는가"**를 보여준다.
 * 문장 하나가 사다리를 한 칸 통과할 때마다 1점이고, 막대는 그 점수의 비율이다.
 * 그래서 "70문장 다 한 번씩 훑었다"와 "40문장을 끝까지 마스터했다"가 구분된다.
 *
 * 색을 셋으로 나눈 이유도 같다. 총량뿐 아니라 **어느 단계에 몰려 있는지**가
 * 보여야 다음에 뭘 해야 할지 알 수 있다.
 */
export function WeekProgressBar({ weeks }: Props) {
  return (
    <section className="weeks">
      {weeks.map((w) => {
        const pct = Math.round(w.ratio * 100)
        const share = (n: number) => (w.max > 0 ? (n / w.max) * 100 : 0)

        return (
          <div key={w.week} className={`week ${w.unlocked ? '' : 'week-locked'}`}>
            <div className="week-head">
              <span className="week-name">{w.week}주차</span>
              <span className="week-titles">
                {w.scenarios.map((s) => s.title).join(' · ')}
              </span>
              {w.unlocked ? (
                <span className="week-pct">{pct}%</span>
              ) : (
                <span className="week-lock">🔒 잠김</span>
              )}
            </div>

            <div
              className="week-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${w.week}주차 진도율`}
            >
              <span className="week-seg week-seg-repeat" style={{ width: `${share(w.bands.repeat)}%` }} />
              <span className="week-seg week-seg-blind" style={{ width: `${share(w.bands.blind)}%` }} />
              <span
                className="week-seg week-seg-freestyle"
                style={{ width: `${share(w.bands.freestyle)}%` }}
              />
            </div>

            {w.unlocked ? (
              <div className="week-legend">
                <span className="week-dot week-seg-repeat" />
                {LEVEL_LABEL.repeat} {w.bands.repeat}
                <span className="week-dot week-seg-blind" />
                {LEVEL_LABEL.blind} {w.bands.blind}
                <span className="week-dot week-seg-freestyle" />
                {LEVEL_LABEL.freestyle} {w.bands.freestyle}
                <span className="week-count">/ {w.turnCount}문장</span>
              </div>
            ) : (
              <p className="week-hint">
                앞 주차를 {Math.round(WEEK_UNLOCK_RATIO * 100)}%까지 채우면 열립니다.
                지금도 <strong>전체 대화</strong> 탭에서는 미리 볼 수 있습니다.
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
