# 수동 시간표 불러오기와 주간 삭제

2026-11-13 완료 기준. 기존 `main`의 `aef2d44`에서 수정했습니다. 자동 적용을 제거하고 사용자가 선택한 주에 명시적으로 불러오는 방식입니다.

## 동작

- `ensureWeek()`는 방문 기록만 저장합니다. 기본 체크, 날짜 변경, 재시작, 템플릿 수정은 날짜별 일정을 생성하지 않습니다.
- 기본 체크는 불러오기 목록에서 첫 번째로 표시할 시간표입니다. 나머지는 저장 순서를 유지하고, 불러올 시간표를 선택해도 기본 체크를 바꾸지 않습니다.
- 주간 화면의 `시간표 불러오기`는 보고 있는 주의 월요일을 라우트에 전달합니다. 선택 화면은 그 날짜를 검증·고정하고 읽기 전용 미리보기와 불러오기 버튼을 제공합니다.
- 기존 일정이 있으면 교체 확인을 받습니다. 미리보기 이후 일정이 생긴 경우에도 저장소에서 확인 없는 덮어쓰기를 거부하고 화면에서 다시 확인합니다.
- `applyPresetToWeek()`는 템플릿 존재와 겹침을 검증한 뒤 선택한 월~일만 삭제하고 새 ID로 복사합니다. 요일·시간·제목·색상을 유지하며 다른 주, 템플릿 원본과 기본 선택은 그대로입니다.
- `clearWeek()`는 선택한 월요일 이상, 다음 월요일 미만의 실제 일정만 삭제합니다. 원본 시간표·다른 주·클립보드는 유지합니다. 빈 주에서는 버튼이 비활성화됩니다.
- 교체·삭제·주 기록·스냅샷 읽기·커밋을 하나의 트랜잭션으로 처리합니다. 실패하면 모두 롤백하고 Provider에는 성공한 스냅샷만 반영합니다.
- 기존 v3의 `applyFromWeek`와 방문 기록은 보존하지만 자동 적용에 사용하지 않습니다. 스키마 버전은 3이며 파괴적 마이그레이션이나 실제 사용자 DB 초기화는 하지 않았습니다.
- 월간 점은 시작 시간순 색상으로 가로 4개, 최대 2줄/8개입니다. compact 달력은 그대로입니다.
- 하단은 달력·주간 계획·캘린더 공유·마이페이지 네 탭입니다. 마이페이지는 개발 중 안내만 제공합니다.

## 변경 파일

| 범위 | 파일 |
|---|---|
| 저장·상태 | `src/lib/repository.ts`, `presets.ts`, `timetable.ts`, `src/types/calendar.ts`, `src/hooks/use-calendar.tsx` |
| 주간 불러오기·삭제 | `src/components/timetable/planning-screen.tsx`, `timetable-picker.tsx`, `src/app/select-timetable.tsx`, `src/app/_layout.tsx` |
| 기본 체크 설명 | `src/components/timetable/preset-list.tsx`, `preset-editor.tsx`, `src/app/settings.tsx` |
| 월간 점·탭 | `src/components/calendar/month-calendar.tsx`, `src/app/(tabs)/_layout.tsx`, `mypage.tsx` |
| 테스트 | `tests/manual-weeks.test.cjs`, `manual-weeks-ui.test.cjs` 추가, 기존 자동 적용 전제와 사본 생성 준비를 수동 불러오기로 변경 |
| SDK 호환성 | `package.json`, `package-lock.json`, `app.json`: Expo 검사에 맞춰 SDK 58 내 패치 업데이트 및 CLI가 추가한 설정 플러그인 |

26px 행 높이, 겹침 차단, 빈 공간 자동 축소, 공유 경계선 리사이징, 드래그·복사·붙여넣기·햅틱·애니메이션 코드는 유지합니다. 템플릿 생성·복제·이름 변경·이전 주간에서 가져오기와 전체 테스트 데이터 초기화도 유지합니다.

## 검증 범위

2026-11-13 최종 실행: `npm run typecheck`, `npm run lint`, `npm test`(137/137), `npx expo install --check` 모두 통과했습니다. Expo 58.0.25 및 SQLite 58.0.17을 포함해 같은 SDK 내 권장 패치를 적용했습니다.

`npx expo export --platform ios --platform android --platform web`도 통과했습니다. 새 선택 화면과 마이페이지 경로를 포함한 번들 생성 확인이며 실제 기기 실행 검증은 아닙니다.

실제 Node SQLite를 사용해 날짜 범위, 새 ID·원본 독립성, 동시 불러오기 차단, 빈 템플릿 교체 확인, 겹친 원본 거부, 삭제·두 번째 복사·방문 기록·스냅샷·커밋 실패 롤백을 검증합니다. 파일 DB를 닫고 다시 열어 삭제한 주가 빈 상태로 남고 다른 템플릿을 다시 불러올 수 있는지도 확인합니다.

실제 React 컴포넌트와 Provider 테스트는 목록 순서, 미리보기 무변경, 교체 취소, 선택한 주 고정, 빠른 중복 탭, 오류 안내, 월간 점 4×2, 네 탭 선택과 Safe Area 값을 검증합니다. 네이티브 뷰·제스처 전달부는 테스트 대역이므로 실제 iPhone 터치와 화면 배치를 대신하지 않습니다.

실기기에서 확인할 절차는 [TOUCH_TESTS.md](TOUCH_TESTS.md)에 정리했습니다. 특히 수동 불러오기·교체 취소, 현재 주만 삭제·재실행, 4×2 점, 네 탭 Safe Area와 기존 제스처를 확인해야 합니다.
