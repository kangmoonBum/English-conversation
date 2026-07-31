#!/usr/bin/env node
/**
 * 시나리오와 발음 팁 라이브러리의 정합성을 검사한다.
 *
 * 자동 채점이 없는 만큼 팁 콘텐츠가 곧 제품 품질이라, 다음을 강하게 검증한다:
 *   - tips[].ref 가 팁 라이브러리에 실제로 존재하는가
 *   - tips[].target 문자열이 해당 문장(text) 안에 실재하는가  ← 하이라이트가 조용히 실패하는 것을 막는다
 *   - 팁 자체가 why/how/selfCheck 3단 구조를 갖췄는가
 *
 * 사용: npm run validate
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIPS_PATH = join(ROOT, 'src/data/pronunciation/tips.json')
const SCENARIO_DIR = join(ROOT, 'src/data/scenarios')

const TIP_CATEGORIES = new Set([
  'consonant', 'vowel', 'ending', 'cluster',
  'rhythm', 'linking', 'reduction', 'intonation',
])

const errors = []
const warnings = []

const err = (where, msg) => errors.push(`${where}: ${msg}`)
const warn = (where, msg) => warnings.push(`${where}: ${msg}`)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    err(basename(path), `JSON 파싱 실패 — ${e.message}`)
    return null
  }
}

// ---------- 팁 라이브러리 ----------
const tips = readJson(TIPS_PATH)
if (!tips) {
  console.error('tips.json을 읽을 수 없어 검증을 중단합니다.')
  process.exit(1)
}

for (const [id, tip] of Object.entries(tips)) {
  const at = `tips.json[${id}]`
  if (!TIP_CATEGORIES.has(tip.category)) {
    err(at, `알 수 없는 category "${tip.category}"`)
  }
  for (const field of ['symbol', 'title', 'why', 'selfCheck']) {
    if (typeof tip[field] !== 'string' || !tip[field].trim()) {
      err(at, `${field}가 비어 있습니다`)
    }
  }
  if (!Array.isArray(tip.how) || tip.how.length === 0) {
    err(at, 'how는 비어 있지 않은 배열이어야 합니다')
  }
  // selfCheck는 "몸으로 확인 가능한 방법"이어야 한다는 것이 이 프로젝트의 핵심 규칙이다.
  if (typeof tip.selfCheck === 'string' && tip.selfCheck.length < 20) {
    warn(at, 'selfCheck가 너무 짧습니다 — 물리적으로 확인 가능한 방법인지 확인하세요')
  }
  if (tip.minimalPairs !== undefined) {
    if (!Array.isArray(tip.minimalPairs)) {
      err(at, 'minimalPairs는 배열이어야 합니다')
    } else {
      tip.minimalPairs.forEach((pair, i) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
          err(at, `minimalPairs[${i}]는 [a, b] 두 항목이어야 합니다`)
          return
        }
        // 최소 대립쌍은 영어 TTS로 재생된다. 한글 표기를 넣으면 엉뚱한 소리가 나므로,
        // 한국어식 발음 대비는 why/how에 글로 쓰고 여기에는 실제 영어 단어만 둔다.
        const nonAscii = pair.find((w) => /[^\x00-\x7F]/.test(w))
        if (nonAscii) {
          err(at, `minimalPairs[${i}]에 영어가 아닌 항목이 있습니다 ("${nonAscii}") — 영어 TTS로 재생됩니다`)
        }
      })
    }
  }
}

// ---------- 시나리오 ----------
const usedTips = new Set()
const scenarioFiles = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'))

if (scenarioFiles.length === 0) {
  err('scenarios', '시나리오 파일이 하나도 없습니다')
}

for (const file of scenarioFiles) {
  const scenario = readJson(join(SCENARIO_DIR, file))
  if (!scenario) continue

  const at = file
  if (scenario.id !== basename(file, '.json')) {
    err(at, `id("${scenario.id}")와 파일명이 일치해야 합니다`)
  }
  for (const field of ['title', 'level', 'userRole']) {
    if (!scenario[field]) err(at, `${field}가 비어 있습니다`)
  }
  if (!scenario.roles?.[scenario.userRole]) {
    err(at, `userRole "${scenario.userRole}"가 roles에 없습니다`)
  }
  for (const role of Object.keys(scenario.roles ?? {})) {
    if (!scenario.voices?.[role]) {
      err(at, `role "${role}"에 대응하는 voices 항목이 없습니다`)
    }
  }

  const seenIds = new Set()
  for (const turn of scenario.turns ?? []) {
    const tAt = `${file} turn#${turn.id}`

    if (seenIds.has(turn.id)) err(tAt, 'turn id가 중복됩니다')
    seenIds.add(turn.id)

    if (!scenario.roles?.[turn.role]) {
      err(tAt, `알 수 없는 role "${turn.role}"`)
    }
    for (const field of ['text', 'ko']) {
      if (!turn[field]?.trim()) err(tAt, `${field}가 비어 있습니다`)
    }
    for (const speed of ['normal', 'slow']) {
      if (!turn.audio?.[speed]) err(tAt, `audio.${speed}가 없습니다`)
    }

    /** 인라인 하이라이트 구간. 겹침 검사를 위해 모아둔다. (src/text.ts와 같은 규칙) */
    const spans = []

    for (const ref of turn.tips ?? []) {
      const rAt = `${tAt} tip "${ref.ref}"`
      if (!tips[ref.ref]) {
        err(rAt, '팁 라이브러리에 없는 ref입니다')
        continue
      }
      usedTips.add(ref.ref)

      // 하이라이트가 조용히 실패하는 것을 막는 핵심 검사.
      if (!ref.target?.trim()) {
        err(rAt, 'target이 비어 있습니다')
        continue
      }
      const start = turn.text.indexOf(ref.target)
      if (start < 0) {
        err(rAt, `target "${ref.target}"이(가) 문장에 없습니다 → "${turn.text}"`)
        continue
      }

      // 문장 절반 이상을 덮는 target은 문장 단위 팁으로 보고 인라인 하이라이트에서 뺀다.
      const isSentenceLevel = ref.target.length / turn.text.length >= 0.5
      if (!isSentenceLevel) {
        spans.push({ ref: ref.ref, target: ref.target, start, end: start + ref.target.length })
      }
    }

    // 구간이 겹치면 UI에서 뒤쪽 팁이 조용히 사라진다. 데이터 단계에서 잡는다.
    spans.sort((a, b) => a.start - b.start)
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].start < spans[i - 1].end) {
        err(
          tAt,
          `target이 겹칩니다 — "${spans[i - 1].target}"(${spans[i - 1].ref})와 ` +
          `"${spans[i].target}"(${spans[i].ref}). 겹치면 뒤쪽 팁이 표시되지 않습니다.`,
        )
      }
    }

    // 학습자 차례인데 팁이 하나도 없으면 이 앱의 존재 이유가 사라진다.
    if (turn.role === scenario.userRole && (turn.tips ?? []).length === 0) {
      warn(tAt, '학습자 차례인데 발음 팁이 없습니다')
    }
    if (turn.role === scenario.userRole && !turn.coach) {
      warn(tAt, '학습자 차례인데 coach 노하우가 없습니다')
    }
  }
}

// ---------- 보고 ----------
const unused = Object.keys(tips).filter((id) => !usedTips.has(id))
if (unused.length > 0) {
  console.log(`ℹ  시나리오에서 아직 안 쓰인 팁 ${unused.length}개: ${unused.join(', ')}`)
}

for (const w of warnings) console.log(`⚠  ${w}`)
for (const e of errors) console.error(`✖  ${e}`)

console.log(
  `\n팁 ${Object.keys(tips).length}개, 시나리오 ${scenarioFiles.length}개 검사 완료 ` +
  `— 오류 ${errors.length}, 경고 ${warnings.length}`
)

process.exit(errors.length > 0 ? 1 : 0)
