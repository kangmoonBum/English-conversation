# 섀도잉 트레이너

상황이 있는 대화를 문장 단위로 따라 말하며 발음을 다듬는 연습 도구입니다.

**자동 채점을 하지 않습니다.** 대신 두 가지로 대신합니다.

1. **원본 → 내 녹음 → 원본** 순서로 번갈아 들으며 직접 비교
2. 문장마다 **발음 유의점**과, 몸으로 확인할 수 있는 **‘맞는지 확인하는 법’**

> 예) `/f/` vs `/p/` — 입 앞 5cm에 종이를 대고 발음하세요.
> `/p/`는 종이가 확 펄럭이고 `/f/`는 거의 움직이지 않습니다.

점수는 스스로 구별하지 못하는 소리를 알려주지 못하고, 초반에 낮게 나와 의욕만
꺾는 경우가 많습니다. 그래서 이 버전은 점수 대신 **자가 검증 방법**을 줍니다.

---

## 특징

- **서버·DB·로그인·런타임 API 호출이 전혀 없습니다.** 정적 파일만으로 동작합니다
- 오디오는 [Piper](https://github.com/rhasspy/piper)로 **빌드 타임에 한 번** 생성해 커밋합니다
- 녹음은 브라우저 안에만 저장되고 **어디에도 전송되지 않습니다** (7일 후 자동 삭제)
- 발음 팁은 재사용 라이브러리로 관리하고, 시나리오가 `ref`로 참조합니다

---

## 시작하기

```bash
npm install
npm run dev          # http://localhost:5173
```

오디오 파일이 아직 없어도 앱은 동작합니다. 이 경우 브라우저 내장 TTS로 임시
재생하며 화면 상단에 배너가 뜹니다. 음질이 낮고 파형·비교 재생을 쓸 수 없으니,
아래 순서로 실제 음성을 생성하세요.

### 음성 생성 (최초 1회)

```bash
npm run audio:setup   # piper-tts 설치 + 음성 모델 2개 내려받기
npm run audio:build   # public/audio/<시나리오>/*.mp3 생성
```

- Python 3.9 이상이 필요합니다
- 음성 모델은 HuggingFace에서 받습니다. 네트워크에서 차단되어 있으면 스크립트가
  직접 받을 주소를 안내하니, `voices/` 폴더에 `.onnx`와 `.onnx.json`을 넣어주세요
- `ffmpeg`가 있으면 mp3로, 없으면 WAV로 생성합니다. 앱은 둘 다 자동으로 찾습니다

전부 다시 생성하려면 `npm run audio:build -- --force`.

---

## 마이크 관련 주의사항

- 마이크는 **HTTPS 또는 `localhost`**에서만 동작합니다.
  폰에서 테스트하려고 `192.168.x.x`로 접속하면 마이크가 막힙니다
  (`mkcert`로 로컬 인증서를 만들거나, 정적 빌드를 HTTPS 호스팅에 올리세요)
- 브라우저의 **잡음 제거·에코 제거·자동 음량 조절을 일부러 꺼둡니다.**
  그 후처리가 `/s/ /f/ /θ/` 같은 마찰음을 깎아내는데, 그건 반드시 직접 들어야 할
  소리이기 때문입니다. 대신 재생할 때 원본과 음량을 맞춰줍니다
- 지금은 **듣고 나서 따라 말하는 방식**이라 헤드폰이 없어도 됩니다.
  (원본과 겹쳐 말하는 오버랩 모드를 추가하면 그때는 헤드폰이 필요합니다)

---

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 체크 + 프로덕션 빌드 |
| `npm test` | 순수 로직 단위 테스트 |
| `npm run validate` | 시나리오·팁 정합성 검증 |
| `npm run audio:setup` | Piper 설치 + 음성 모델 |
| `npm run audio:build` | 오디오 생성 |

`npm run validate`는 다음을 검사합니다.

- 시나리오가 참조하는 팁 `ref`가 실제로 존재하는지
- 하이라이트 `target` 문자열이 문장 안에 실재하는지
- `target`끼리 겹쳐서 팁이 조용히 사라지지 않는지
- 팁이 `why` / `how` / `selfCheck` 3단 구조를 갖췄는지

---

## 구조

```
src/
├── data/
│   ├── pronunciation/tips.json   # 재사용 발음 팁 24개
│   └── scenarios/*.json          # 대화 시나리오
├── audio/
│   ├── source.ts                 # 오디오 출처 추상화 (파일 → 브라우저 TTS 폴백)
│   ├── recorder.ts               # 마이크 (후처리 OFF)
│   ├── normalize.ts              # 음량 정규화·무음 트림
│   ├── player.ts                 # 재생 · A/B/A 시퀀스
│   └── waveform.ts               # 파형 렌더
├── analysis/provider.ts          # 채점을 붙일 자리 (현재 no-op)
├── store/                        # localStorage 진행도 · IndexedDB 녹음
└── components/
```

### 시나리오 추가하기

`src/data/scenarios/<id>.json`을 만들고 `npm run validate`로 검증한 뒤
`npm run audio:build`를 실행하면 됩니다. 팁은 `tips.json`에 있는 것을
`ref`로 참조하고, 없으면 새로 추가하세요.

```jsonc
{
  "id": "turn-id와 파일명이 같아야 합니다",
  "text": "Could I get a large iced americano, please?",
  "ko": "아이스 아메리카노 라지 하나 주세요.",
  "tips": [
    { "ref": "linking-cv", "target": "Could I get a" },  // target은 text에 실재해야 함
    { "ref": "final-stop", "target": "iced" }
  ],
  "coach": "일반 규칙으로 환원되지 않는 이 문장만의 노하우"
}
```

---

## 아직 없는 것

초기 버전은 **따라 말하기(리피팅) 한 단계**에 집중합니다. 다음은 의도적으로 뺐습니다.

- 오버랩(동시 섀도잉) · 블라인드 · 롤플레이 · 프리스타일 모드
- 자기 평가 기반 복습 큐 (평가는 기록만 하고 있습니다)
- 자동 채점, 실시간 AI 대화 상대
- 발음 노트 누적 화면, 최소 대립쌍 전용 드릴
- PWA, 배포 설정

시나리오 스키마에는 `keywords` / `intentKo` / `alternatives`를 미리 채워두었습니다.
나중에 모드를 추가할 때 시나리오를 다시 쓰지 않기 위해서입니다.
