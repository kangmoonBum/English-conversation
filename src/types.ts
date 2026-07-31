/** 발음 팁 분류. UI에서 배지 색을 나누는 데 쓴다. */
export type TipCategory =
  | 'consonant'
  | 'vowel'
  | 'ending'
  | 'cluster'
  | 'rhythm'
  | 'linking'
  | 'reduction'
  | 'intonation'

/**
 * 재사용 가능한 발음 팁 하나.
 *
 * 자동 채점이 없는 대신, 학습자가 스스로 맞는지 확인할 수단을 반드시 준다.
 * 그래서 `selfCheck`는 "몸으로 관찰 가능한 물리적 검증"이어야 한다.
 * (예: 목에 손을 대서 진동 확인, 입 앞에 종이를 대서 바람 확인)
 */
export interface Tip {
  category: TipCategory
  /** 음성 기호 또는 짧은 라벨. 예: "/r/", "강세" */
  symbol: string
  /** 한 줄 요약 제목 */
  title: string
  /** 한국어 화자가 왜/어떻게 틀리는지 */
  why: string
  /** 어떻게 발음하는지 — 순서가 있는 동작 지시 */
  how: string[]
  /** 맞게 하고 있는지 스스로 확인하는 물리적 방법 */
  selfCheck: string
  /** 최소 대립쌍. 들어서 구별이 안 되면 발음도 안 되므로 함께 제공한다. */
  minimalPairs?: [string, string][]
}

export type TipLibrary = Record<string, Tip>

/** 시나리오 문장이 팁 라이브러리를 참조하는 방식 */
export interface TipRef {
  /** TipLibrary의 키 */
  ref: string
  /** 문장(text) 안에서 하이라이트할 부분 문자열 */
  target: string
}

export type Speed = 'normal' | 'slow'

export interface Turn {
  id: number
  /** Scenario.roles의 키. 보통 'A' | 'B' */
  role: string
  text: string
  /** 한국어 뜻 */
  ko: string
  /** 속도별 오디오 파일명 (public/audio/<scenarioId>/ 기준 상대 경로) */
  audio: Record<Speed, string>

  /** --- 아래는 초기 버전에서 쓰지 않지만, 나중 모드를 위해 미리 채워둔다 --- */
  /** L3 블라인드 모드용 키워드 힌트 */
  keywords?: string[]
  /** 프리스타일 모드용 한국어 지시문 */
  intentKo?: string
  /** 프리스타일 모드용 모범 답안들 */
  alternatives?: string[]

  /** 이 문장에서 짚어야 할 발음 유의점 */
  tips?: TipRef[]
  /** 일반 규칙으로 환원되지 않는 이 문장만의 노하우 */
  coach?: string
}

export interface Scenario {
  id: string
  title: string
  /** CEFR 레벨 표기. 예: "A2" */
  level: string
  /** 역할 키 → 표시 이름. 예: { A: "Barista", B: "Customer" } */
  roles: Record<string, string>
  /** 학습자가 맡는 역할 키 */
  userRole: string
  /** 역할 키 → Piper 음성 모델 이름 */
  voices: Record<string, string>
  turns: Turn[]
}

/** 자기 평가 3단계. 채점이 없으므로 이것이 유일한 복습 신호다. */
export type Rating = 'again' | 'ok' | 'good'

/**
 * 문장별 연습 난이도.
 *
 * 복습 큐가 단순히 같은 드릴을 반복시키는 게 아니라 이 사다리를 한 칸씩 올려준다.
 * 😀를 받으면 다음에 그 문장은 더 어려운 단계로 나타나므로, "복습"과 "실력 향상"이
 * 같은 동작이 된다.
 *
 *   repeat    영문 전체를 보고 따라 말하기
 *   blind     키워드만 보고 소리로 복원하기
 *   freestyle 한국어 지시만 보고 자유롭게 말하기
 */
export type PracticeLevel = 'repeat' | 'blind' | 'freestyle'

export interface TurnProgress {
  /** 다음에 이 문장을 어느 단계로 낼지 */
  level: PracticeLevel
  /** 복습 기한 (epoch ms). 이 시각이 지나면 오늘의 연습에 나타난다. */
  dueAt: number
  rating: Rating
  /** epoch ms */
  ratedAt: number
  /** 녹음 시도 횟수 */
  attempts: number
}

export interface Progress {
  version: 2
  /** scenarioId → turnId → 진행도 */
  scenarios: Record<string, Record<string, TurnProgress>>
}

/** 마이그레이션 전 형식. loadProgress에서만 쓴다. */
export interface ProgressV1 {
  version: 1
  scenarios: Record<
    string,
    Record<string, { rating: Rating; ratedAt: number; attempts: number }>
  >
}

/** 녹음이 끝났을 때 Recorder가 돌려주는 결과 */
export interface RecordingResult {
  blob: Blob
  mimeType: string
}

/** 녹음 한 건. IndexedDB에 저장한다. */
export interface RecordingRecord {
  /** `${scenarioId}:${turnId}` */
  key: string
  scenarioId: string
  turnId: number
  blob: Blob
  mimeType: string
  /** epoch ms — TTL 정리에 쓴다 */
  createdAt: number
}
