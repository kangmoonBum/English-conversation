#!/usr/bin/env node
/**
 * Piper TTS 설치 + 음성 모델 내려받기.
 *
 * 이 프로젝트는 런타임에 어떤 API도 호출하지 않는다. 대화 오디오는 개발자
 * PC에서 한 번 생성해 저장소에 커밋하고, 앱은 그 정적 파일만 재생한다.
 * 따라서 이 스크립트는 최초 1회(또는 시나리오를 추가했을 때)만 실행하면 된다.
 *
 * 사용: npm run audio:setup
 */
import { mkdirSync, existsSync, statSync, createWriteStream, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOICES_DIR = join(ROOT, 'voices')

/**
 * 쓰는 음성.
 *
 * 둘 다 단일 화자 전문 녹음이라 "정제된 낭독" 음색이 나온다.
 * 다화자 모델(libritts 등)은 화자마다 품질 편차가 커서 쓰지 않는다.
 *
 *   lessac  Lessac Technologies의 상용 TTS용 스튜디오 녹음. 중립적이고 깨끗하다.
 *   ryan    오디오북 낭독 데이터. high 품질이라 자연스러움이 한 단계 위다.
 *
 * 바꾸고 싶으면 여기와 시나리오 JSON의 `voices`를 함께 고치면 된다.
 * v0.0.2 릴리스에서 받을 수 있는 다른 영어 음성:
 *   en-us-ryan-medium, en-us-ryan-low, en-us-amy-low, en-us-kathleen-low
 */
const VOICES = ['en-us-lessac-medium', 'en-us-ryan-high']

/**
 * 음성 모델 배포처.
 *
 * 현재 공식 배포처는 HuggingFace지만, 사내망 등에서 차단되는 경우가 많다.
 * Piper 초기 릴리스가 GitHub에 같은 모델을 올려두었고 그쪽이 훨씬 잘 뚫리므로
 * GitHub을 먼저 시도하고 실패하면 HuggingFace로 넘어간다.
 */
const GITHUB_BASE = 'https://github.com/rhasspy/piper/releases/download/v0.0.2'
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

/** HuggingFace는 경로 구조가 달라서 이름을 변환해야 한다. */
function hfPath(voice) {
  // en-us-ryan-high → en/en_US/ryan/high, en_US-ryan-high
  const m = voice.match(/^en-us-(.+)-(low|medium|high)$/)
  if (!m) return null
  return { dir: `en/en_US/${m[1]}/${m[2]}`, name: `en_US-${m[1]}-${m[2]}` }
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })

function pythonCmd() {
  for (const cmd of ['python3', 'python']) {
    if (run(cmd, ['--version']).status === 0) return cmd
  }
  return null
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

/** GitHub 릴리스는 tar.gz로 묶여 있다. 풀면 <voice>.onnx 와 .onnx.json 이 나온다. */
async function fromGithub(voice) {
  const tgz = join(VOICES_DIR, `${voice}.tar.gz`)
  await download(`${GITHUB_BASE}/voice-${voice}.tar.gz`, tgz)
  const tar = run('tar', ['xzf', tgz, '-C', VOICES_DIR])
  rmSync(tgz, { force: true })
  rmSync(join(VOICES_DIR, 'MODEL_CARD'), { force: true })
  if (tar.status !== 0) throw new Error(`압축 해제 실패: ${tar.stderr ?? ''}`)
}

/** HuggingFace는 파일을 따로 받고 이름이 en_US-... 형태라 우리 규칙으로 바꿔 저장한다. */
async function fromHuggingFace(voice) {
  const hf = hfPath(voice)
  if (!hf) throw new Error('HuggingFace 경로를 알 수 없는 음성입니다')
  for (const ext of ['.onnx', '.onnx.json']) {
    await download(`${HF_BASE}/${hf.dir}/${hf.name}${ext}?download=true`, join(VOICES_DIR, `${voice}${ext}`))
  }
}

const haveVoice = (voice) =>
  existsSync(join(VOICES_DIR, `${voice}.onnx`)) &&
  statSync(join(VOICES_DIR, `${voice}.onnx`)).size > 1024 * 1024 &&
  existsSync(join(VOICES_DIR, `${voice}.onnx.json`))

async function main() {
  console.log('Piper TTS 셋업을 시작합니다.\n')

  // ---------- 1. piper-tts 설치 ----------
  const python = pythonCmd()
  if (!python) {
    console.error('✖ python3를 찾을 수 없습니다. Python 3.9 이상을 먼저 설치하세요.')
    process.exit(1)
  }

  if (run(python, ['-c', 'import piper']).status === 0) {
    console.log('✓ piper-tts가 이미 설치되어 있습니다.')
  } else {
    console.log('· piper-tts를 설치합니다 (pip install piper-tts)...')
    const pip = run(python, ['-m', 'pip', 'install', '--quiet', 'piper-tts'], { stdio: 'inherit' })
    if (pip.status !== 0) {
      console.error(
        '\n✖ piper-tts 설치에 실패했습니다.\n' +
        '  가상환경을 쓰고 있다면 활성화한 뒤 다시 시도하거나 직접 설치하세요:\n' +
        `    ${python} -m pip install piper-tts\n`,
      )
      process.exit(1)
    }
    console.log('✓ piper-tts 설치 완료')
  }

  // ---------- 2. 음성 모델 ----------
  mkdirSync(VOICES_DIR, { recursive: true })

  for (const voice of VOICES) {
    if (haveVoice(voice)) {
      console.log(`✓ ${voice} (이미 있음)`)
      continue
    }

    const failures = []
    let ok = false

    for (const [label, fetcher] of [
      ['GitHub', fromGithub],
      ['HuggingFace', fromHuggingFace],
    ]) {
      process.stdout.write(`· ${voice} — ${label}에서 내려받는 중... `)
      try {
        await fetcher(voice)
        if (!haveVoice(voice)) throw new Error('받은 파일이 올바르지 않습니다')
        console.log('완료')
        ok = true
        break
      } catch (e) {
        console.log('실패')
        failures.push(`${label}: ${e.message}`)
      }
    }

    if (!ok) {
      console.error(
        `\n✖ ${voice} 를 받지 못했습니다.\n` +
        failures.map((f) => `    ${f}`).join('\n') +
        '\n\n  네트워크에서 두 곳 모두 차단된 것 같습니다.\n' +
        '  브라우저로 아래 파일을 받아 voices/ 폴더에 넣어주세요:\n' +
        `    ${GITHUB_BASE}/voice-${voice}.tar.gz\n` +
        `  (압축을 풀면 ${voice}.onnx 와 ${voice}.onnx.json 이 나옵니다.)\n`,
      )
      process.exit(1)
    }
  }

  // ---------- 3. ffmpeg 확인 (선택) ----------
  if (run('ffmpeg', ['-version']).status === 0) {
    console.log('✓ ffmpeg 사용 가능 — mp3로 변환합니다.')
  } else {
    console.log(
      '⚠ ffmpeg가 없습니다. WAV로 생성합니다 (동작에는 문제없고 용량만 커집니다).\n' +
      '  mp3를 원하면 ffmpeg를 설치한 뒤 audio:build를 다시 실행하세요.',
    )
  }

  console.log('\n셋업 완료. 이제 `npm run audio:build`를 실행하세요.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
