import type { RecordingResult } from '../types'

/**
 * 마이크 녹음.
 *
 * ★ 브라우저 기본 오디오 후처리를 전부 끈다.
 *   노이즈 억제는 /s/ /f/ /θ/ 같은 마찰음을 잡음으로 오인해 깎아내는데,
 *   그건 한국어 화자가 가장 많이 틀리고, 따라서 반드시 직접 들어야 할 소리다.
 *   자동 음량 조절(AGC)도 끄고, 대신 재생 시점에 normalize.ts로 음량을 맞춘다.
 */
const CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

/** 브라우저마다 지원 포맷이 달라서(Chrome webm/opus, Safari mp4/aac) 순서대로 시도한다. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

export class MicPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MicPermissionError'
  }
}

export class Recorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  /** 마이크 권한을 미리 받아둔다. 첫 녹음의 지연을 없애기 위해 화면 진입 시 호출한다. */
  async prime(): Promise<void> {
    await this.acquireStream()
  }

  private async acquireStream(): Promise<MediaStream> {
    if (this.stream?.active) return this.stream

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicPermissionError(
        '이 브라우저에서는 마이크를 쓸 수 없습니다. HTTPS 또는 localhost에서 접속했는지 확인하세요.',
      )
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: CAPTURE_CONSTRAINTS,
      })
      return this.stream
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new MicPermissionError(
          '마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 허용해주세요.',
        )
      }
      if (name === 'NotFoundError') {
        throw new MicPermissionError('마이크를 찾을 수 없습니다. 입력 장치를 확인해주세요.')
      }
      throw e
    }
  }

  async start(): Promise<void> {
    if (this.isRecording) return

    const stream = await this.acquireStream()
    const mimeType = pickMimeType()
    if (!mimeType) {
      throw new Error('이 브라우저는 녹음을 지원하지 않습니다.')
    }

    this.chunks = []
    this.recorder = new MediaRecorder(stream, { mimeType })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  async stop(): Promise<RecordingResult> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') {
      throw new Error('녹음 중이 아닙니다.')
    }

    return new Promise<RecordingResult>((resolve, reject) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(this.chunks, { type: mimeType })
        this.chunks = []
        this.recorder = null
        if (blob.size === 0) {
          reject(new Error('녹음된 데이터가 없습니다. 마이크 입력을 확인해주세요.'))
          return
        }
        resolve({ blob, mimeType })
      }
      recorder.onerror = () => reject(new Error('녹음 중 오류가 발생했습니다.'))
      recorder.stop()
    })
  }

  /** 스트림을 놓아준다. 탭의 마이크 표시등을 끄기 위해 화면을 벗어날 때 호출한다. */
  release(): void {
    this.recorder = null
    this.chunks = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
