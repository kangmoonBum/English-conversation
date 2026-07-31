import type { Turn } from '../types'

/**
 * 녹음 분석 지점.
 *
 * 초기 버전은 자동 채점을 넣지 않는다. 점수 대신 학습자가 직접 듣고 비교하고,
 * 발음 팁의 selfCheck로 스스로 확인한다.
 *
 * 그럼에도 이 파일을 두는 이유는, 나중에 채점(예: Azure Pronunciation Assessment)을
 * 붙이기로 마음이 바뀌었을 때 **녹음을 다루는 지점이 여기 하나로 모여 있게** 하기
 * 위해서다. UI는 AnalysisProvider 인터페이스에만 의존하므로, 그때 구현체 하나만
 * 갈아끼우면 된다.
 */

export interface AnalysisResult {
  /** 0~100. 초기 버전에서는 항상 비어 있다. */
  accuracy?: number
  fluency?: number
  prosody?: number
  /** 단어별 결과 등 구현체가 주는 부가 정보 */
  detail?: unknown
}

export interface AnalysisProvider {
  readonly enabled: boolean
  analyze(turn: Turn, recording: Blob): Promise<AnalysisResult | null>
}

/** 아무것도 하지 않는 기본 구현. */
export const nullAnalysisProvider: AnalysisProvider = {
  enabled: false,
  async analyze() {
    return null
  },
}

let provider: AnalysisProvider = nullAnalysisProvider

export function getAnalysisProvider(): AnalysisProvider {
  return provider
}

export function setAnalysisProvider(next: AnalysisProvider): void {
  provider = next
}
