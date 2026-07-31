import { useEffect, useRef } from 'react'
import { drawWaveform, samplesForDisplay, spokenDuration } from '../audio/waveform'
import { computePeak } from '../audio/normalize'

interface Props {
  original: AudioBuffer | null
  mine: AudioBuffer | null
}

function Row({
  label,
  buffer,
  color,
  scale,
}: {
  label: string
  buffer: AudioBuffer | null
  color: string
  scale?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current || !buffer) return
    drawWaveform(ref.current, samplesForDisplay(buffer), { color, normalizeTo: scale })
  }, [buffer, color, scale])

  return (
    <div className="wave-row">
      <span className="wave-label">{label}</span>
      <canvas ref={ref} className="wave-canvas" />
      <span className="wave-duration">
        {buffer ? `${spokenDuration(buffer).toFixed(1)}초` : '—'}
      </span>
    </div>
  )
}

/**
 * 원본과 내 녹음의 파형을 나란히 보여준다.
 *
 * 점수 대신 눈으로 확인하는 장치다. 여기서 가장 잘 보이는 것은 **길이와
 * 쉼의 위치**인데, 초보자의 가장 큰 문제가 바로 그것이다 — 너무 느리게
 * 말하거나, 원어민이 붙여 말하는 곳에서 끊어 읽는다.
 */
export function WaveformCompare({ original, mine }: Props) {
  if (!original && !mine) return null

  // 두 파형의 세로 비율을 같은 기준으로 맞춰야 크기 비교가 의미를 갖는다.
  const scale = Math.max(
    original ? computePeak(samplesForDisplay(original)) : 0,
    mine ? computePeak(samplesForDisplay(mine)) : 0,
  )

  const gap =
    original && mine ? spokenDuration(mine) - spokenDuration(original) : null

  return (
    <div className="waveforms">
      <Row label="원본" buffer={original} color="#5b9dd9" scale={scale} />
      <Row label="내 녹음" buffer={mine} color="#e0a458" scale={scale} />

      {gap !== null && Math.abs(gap) > 0.4 && (
        <p className="wave-note">
          {gap > 0
            ? `원본보다 ${gap.toFixed(1)}초 깁니다. 약한 음절을 더 뭉개서 빠르게 지나가 보세요.`
            : `원본보다 ${Math.abs(gap).toFixed(1)}초 짧습니다. 강세 음절을 충분히 길게 끌어보세요.`}
        </p>
      )}
    </div>
  )
}
