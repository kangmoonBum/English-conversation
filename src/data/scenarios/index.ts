import type { Scenario } from '../../types'
import cafeOrder from './cafe-order-01.json'
import hotelCheckin from './hotel-checkin-02.json'
import smalltalkWeekend from './smalltalk-weekend-03.json'
import phoneAppointment from './phone-appointment-04.json'

/**
 * 연습할 수 있는 상황 목록. 쉬운 것부터 둔다.
 *
 * 시나리오를 추가하려면 JSON을 만들고 여기 import만 더하면 된다.
 * `npm run validate`가 팁 참조와 하이라이트 정합성을, `npm run audio:build`가
 * 음성 생성을 각각 알아서 처리한다.
 */
export const SCENARIOS: Scenario[] = [
  cafeOrder,
  hotelCheckin,
  smalltalkWeekend,
  phoneAppointment,
] as unknown as Scenario[]

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}
