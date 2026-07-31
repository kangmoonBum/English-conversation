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
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VOICES_DIR = join(ROOT, 'voices')

/**
 * 시나리오에서 쓰는 음성. 역할마다 다른 목소리를 써서 화자를 구분한다.
 * 시나리오 JSON의 `voices` 값과 이름이 일치해야 한다.
 */
const VOICES = [
  { name: 'en_US-lessac-medium', path: 'en/en_US/lessac/medium' },
  { name: 'en_US-amy-medium', path: 'en/en_US/amy/medium' },
]

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

function pythonCmd() {
  for (const cmd of ['python3', 'python']) {
    if (run(cmd, ['--version']).status === 0) return cmd
  }
  return null
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} — ${url}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function main() {
  console.log('Piper TTS 셋업을 시작합니다.\n')

  // ---------- 1. piper-tts 설치 ----------
  const python = pythonCmd()
  if (!python) {
    console.error('✖ python3를 찾을 수 없습니다. Python 3.9 이상을 먼저 설치하세요.')
    process.exit(1)
  }

  const installed = run(python, ['-c', 'import piper']).status === 0
  if (installed) {
    console.log('✓ piper-tts가 이미 설치되어 있습니다.')
  } else {
    console.log('· piper-tts를 설치합니다 (pip install piper-tts)...')
    const pip = run(python, ['-m', 'pip', 'install', '--quiet', 'piper-tts'], {
      stdio: 'inherit',
    })
    if (pip.status !== 0) {
      console.error(
        '\n✖ piper-tts 설치에 실패했습니다.\n' +
        '  가상환경을 쓰고 있다면 활성화한 뒤 다시 시도하거나, 직접 설치하세요:\n' +
        `    ${python} -m pip install piper-tts\n`,
      )
      process.exit(1)
    }
    console.log('✓ piper-tts 설치 완료')
  }

  // ---------- 2. 음성 모델 내려받기 ----------
  mkdirSync(VOICES_DIR, { recursive: true })

  for (const voice of VOICES) {
    for (const ext of ['.onnx', '.onnx.json']) {
      const file = `${voice.name}${ext}`
      const dest = join(VOICES_DIR, file)

      // .onnx는 수십 MB라 크기까지 확인해야 중간에 끊긴 파일을 걸러낼 수 있다.
      if (existsSync(dest) && statSync(dest).size > 1024) {
        console.log(`✓ ${file} (이미 있음)`)
        continue
      }

      const url = `${HF_BASE}/${voice.path}/${file}?download=true`
      console.log(`· ${file} 내려받는 중...`)
      try {
        await download(url, dest)
        console.log(`✓ ${file}`)
      } catch (e) {
        console.error(
          `\n✖ ${file} 내려받기 실패 — ${e.message}\n\n` +
          '  네트워크에서 huggingface.co가 차단되어 있을 수 있습니다.\n' +
          '  브라우저로 아래 주소에서 직접 받아 voices/ 폴더에 넣어주세요:\n' +
          `    ${HF_BASE}/${voice.path}/${file}\n\n` +
          '  (.onnx 와 .onnx.json 두 파일이 모두 필요합니다.)\n',
        )
        process.exit(1)
      }
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
