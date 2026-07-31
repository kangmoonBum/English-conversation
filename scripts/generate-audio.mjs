#!/usr/bin/env node
/**
 * 시나리오 JSON + 발음 팁 → Piper → 오디오 파일.
 *
 * 빌드 타임에 한 번만 돌린다. 결과물(public/audio/**)은 저장소에 커밋해서
 * 앱이 런타임에 어떤 API도 호출하지 않도록 한다. 앱에는 브라우저 내장 TTS
 * 폴백이 없으므로, 여기서 만든 파일이 유일한 음성이다.
 *
 * 사용:
 *   npm run audio:build            # 없는 파일만 생성
 *   npm run audio:build -- --force # 전부 다시 생성
 */
import { readFileSync, readdirSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOICES_DIR = join(ROOT, 'voices')
const SCENARIO_DIR = join(ROOT, 'src/data/scenarios')
const TIPS_PATH = join(ROOT, 'src/data/pronunciation/tips.json')
const OUT_ROOT = join(ROOT, 'public/audio')

/** 최소 대립쌍 단어가 들어갈 곳. 여러 시나리오가 공유한다. */
const WORDS_DIR = join(OUT_ROOT, '_words')

/**
 * 단어 드릴에 쓸 음성.
 *
 * 반드시 22050Hz 모델을 쓴다. 최소 대립쌍은 see/she, think/sink처럼 마찰음
 * 차이를 듣는 것이 전부인데, 그 에너지는 4~8kHz에 몰려 있다. 16kHz 모델은
 * 그 대역이 잘려서 정작 구별해야 할 소리가 뭉개진다.
 */
const WORD_VOICE = 'en-us-ryan-high'

const force = process.argv.includes('--force')

/**
 * 속도별 length-scale.
 *
 * Piper는 SSML을 지원하지 않아 속도 제어는 이 값이 전부다. 값이 클수록 느려진다.
 * 브라우저의 playbackRate로 늦추면 음높이까지 같이 내려가 부자연스러운데,
 * length-scale은 음높이를 유지한 채 길이만 늘려서 학습용으로 훨씬 낫다.
 * 그래서 느린 버전을 별도 파일로 미리 만들어 둔다.
 */
const SPEEDS = { normal: 1.0, slow: 1.35 }

/** 단어 하나는 조금 느리게 읽어야 소리 차이가 들린다. */
const WORD_LENGTH_SCALE = 1.2

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

function pythonCmd() {
  for (const cmd of ['python3', 'python']) {
    if (run(cmd, ['--version']).status === 0) return cmd
  }
  return null
}

const hasFfmpeg = () => run('ffmpeg', ['-version']).status === 0

/**
 * Piper CLI는 버전에 따라 출력 플래그 이름이 다르다(--output_file / --output-file).
 * 1.6 기준으로는 둘 다 별칭으로 받지만, 구버전 호환을 위해 실제 지원하는 쪽을 고른다.
 */
function detectOutputFlag(python) {
  const help = run(python, ['-m', 'piper', '--help'])
  const text = `${help.stdout ?? ''}${help.stderr ?? ''}`
  if (text.includes('--output-file')) return '--output-file'
  if (text.includes('--output_file')) return '--output_file'
  return '--output_file'
}

function synthesize(python, outputFlag, { text, model, lengthScale, dest }) {
  const result = run(
    python,
    ['-m', 'piper', '--model', model, outputFlag, dest, '--length-scale', String(lengthScale)],
    { input: text },
  )
  if (result.status !== 0 || !existsSync(dest)) {
    throw new Error(`Piper 실행 실패 (exit ${result.status})\n${result.stderr ?? ''}`)
  }
}

function toMp3(wavPath, mp3Path) {
  // 말소리는 64kbps 모노로 충분하다. 파일이 저장소에 커밋되므로 용량을 아낀다.
  const result = run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', wavPath,
    '-ac', '1', '-ar', '22050', '-b:a', '64k',
    mp3Path,
  ])
  if (result.status !== 0) throw new Error(`ffmpeg 변환 실패\n${result.stderr ?? ''}`)
}

/**
 * 단어 → 파일명. 앱의 src/audio/source.ts에 같은 규칙이 있다.
 * 한쪽만 고치면 조용히 404가 되므로 함께 고쳐야 한다.
 */
export function wordSlug(word) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function modelPath(voiceName) {
  const p = join(VOICES_DIR, `${voiceName}.onnx`)
  if (!existsSync(p)) {
    console.error(
      `  ✖ 음성 모델이 없습니다: ${p}\n    \`npm run audio:setup\`을 먼저 실행하세요.`,
    )
    process.exit(1)
  }
  return p
}

function main() {
  const python = pythonCmd()
  if (!python || run(python, ['-c', 'import piper']).status !== 0) {
    console.error('✖ piper-tts가 설치되어 있지 않습니다. 먼저 `npm run audio:setup`을 실행하세요.')
    process.exit(1)
  }

  const outputFlag = detectOutputFlag(python)
  const ffmpeg = hasFfmpeg()
  if (!ffmpeg) {
    console.log('⚠ ffmpeg가 없어 WAV로 생성합니다. 앱은 .mp3가 없으면 .wav를 자동으로 찾습니다.\n')
  }

  let created = 0
  let skipped = 0

  /** 하나 만들기. 이미 있으면 건너뛴다. */
  const emit = (outDir, declaredName, { text, model, lengthScale, label }) => {
    const target = ffmpeg ? declaredName : `${basename(declaredName, extname(declaredName))}.wav`
    const dest = join(outDir, target)
    if (existsSync(dest) && !force) {
      skipped++
      return
    }
    const tmpWav = join(tmpdir(), `piper-${Date.now()}-${Math.round(Math.random() * 1e6)}.wav`)
    try {
      synthesize(python, outputFlag, { text, model, lengthScale, dest: tmpWav })
      if (ffmpeg) toMp3(tmpWav, dest)
      else copyFileSync(tmpWav, dest)
      created++
      console.log(`  ✓ ${target}  ${label}`)
    } catch (e) {
      console.error(`  ✖ ${target} — ${e.message}`)
      process.exitCode = 1
    } finally {
      rmSync(tmpWav, { force: true })
    }
  }

  // ---------- 시나리오 대사 ----------
  const scenarioFiles = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json'))

  for (const file of scenarioFiles) {
    const scenario = JSON.parse(readFileSync(join(SCENARIO_DIR, file), 'utf8'))
    const outDir = join(OUT_ROOT, scenario.id)
    mkdirSync(outDir, { recursive: true })

    console.log(`\n▸ ${scenario.title} (${scenario.id})`)

    for (const turn of scenario.turns) {
      const voiceName = scenario.voices?.[turn.role]
      if (!voiceName) {
        console.error(`  ✖ turn#${turn.id}: role "${turn.role}"에 대응하는 voices 항목이 없습니다`)
        process.exitCode = 1
        continue
      }
      const model = modelPath(voiceName)

      for (const [speed, lengthScale] of Object.entries(SPEEDS)) {
        const declared = turn.audio?.[speed]
        if (!declared) continue
        emit(outDir, declared, {
          text: turn.text,
          model,
          lengthScale,
          label: `"${turn.text.slice(0, 38)}${turn.text.length > 38 ? '…' : ''}"`,
        })
      }
    }
  }

  // ---------- 최소 대립쌍 단어 ----------
  // 앱에 브라우저 내장 TTS가 없으므로 이 파일이 없으면 단어 재생 버튼이 비활성된다.
  const tips = JSON.parse(readFileSync(TIPS_PATH, 'utf8'))
  const words = new Set()
  for (const tip of Object.values(tips)) {
    for (const pair of tip.minimalPairs ?? []) {
      for (const w of pair) words.add(w)
    }
  }

  if (words.size > 0) {
    mkdirSync(WORDS_DIR, { recursive: true })
    console.log(`\n▸ 최소 대립쌍 단어 (${words.size}개)`)
    const model = modelPath(WORD_VOICE)
    for (const word of [...words].sort()) {
      emit(WORDS_DIR, `${wordSlug(word)}.mp3`, {
        text: word,
        model,
        lengthScale: WORD_LENGTH_SCALE,
        label: word,
      })
    }
  }

  console.log(`\n생성 ${created}개, 건너뜀 ${skipped}개.`)
  if (skipped > 0 && !force) {
    console.log('이미 있는 파일은 건너뛰었습니다. 전부 다시 만들려면: npm run audio:build -- --force')
  }
}

main()
