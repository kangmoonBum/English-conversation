// vite.config.ts와 분리해 둔다. vitest가 자체 vite를 중첩 설치해서
// 한 파일에 합치면 플러그인 타입이 충돌한다.
// 테스트 대상은 순수 로직(정규화·문장 분할)뿐이라 react 플러그인이 필요 없다.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
