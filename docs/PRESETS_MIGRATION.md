# UI 개선과 다중 시간표

## 구현 방식

- 누르는 즉시 Reanimated spring으로 scale 0.97, 350ms 인식 시 0.985와 선택 테두리·햅틱, 이동 중 1.015와 그림자를 적용합니다. 이동 미리보기는 손가락의 세부 좌표를 따르고 저장은 기존 30분 단위를 유지합니다. 놓기·취소·스크롤 인계·화면 이탈 시 상태를 복원합니다.
- `복사 | 삭제`는 가로형 커스텀 메뉴입니다. 기본 글꼴 15pt/보통 굵기, 높이 38pt에서 시작하고 글자 확대에 따라 크기를 늘립니다. 두 항목은 기본 배율에서 약 109pt 너비이고 붙여넣기는 별도 너비입니다. 얇은 구분선·작은 꼬리·120ms 등장 효과·Safe Area 배치를 적용합니다.
- 공식 [Expo SDK 58 ContextMenu](https://docs.expo.dev/versions/v58.0.0/sdk/ui/swift-ui/contextmenu/)도 검토했습니다. 이 네이티브 컴포넌트는 long-press Trigger로 여는 시스템 컨텍스트 메뉴입니다. 요청한 손을 놓은 뒤 표시, 가로 텍스트 선택형 모양, 기존 이동·리사이징 제스처와의 통합을 위해 커스텀 방식을 택했습니다. 시스템 텍스트 선택 메뉴 자체는 아니며 iOS 버전별 네이티브 디자인과 픽셀 단위 일치를 주장하지 않습니다. 별도 네이티브 모듈은 추가하지 않았습니다.
- 메뉴의 삭제는 같은 Modal 안에서 작은 iOS 형태 확인 카드로 전환합니다. 모달을 연달아 띄우는 충돌을 피하고, 확인한 일정 ID만 삭제합니다. 확인 카드와 생성 선택 시트도 커스텀 RN UI입니다.
- 위쪽의 중복 요일 버튼 행을 제거했습니다. 실제 열 헤더의 요일 탭에 확대·선택을 연결하고 가로 오프셋을 헤더에 반영합니다.
- 설정의 기본 시간표 관리는 목록으로 진입합니다. 왼쪽 체크는 단일 기본 선택, 오른쪽 이름은 개별 편집입니다. 빈 시간표 생성, 이름 변경, 기본 지정, 삭제, 이전 주간계획 및 저장된 시간표 불러오기를 지원합니다.
- 가져오기 전에 기존 격자를 읽기 전용으로 재사용해 미리 봅니다. 기존 내용이 있으면 교체 확인을 받습니다. 신규 생성은 불러오기 확정 전에는 DB를 변경하지 않습니다.

## SQLite v1 → v2

아래는 다중 시간표 도입 당시의 v1→v2 이전입니다. 현재 `CalendarRepository.initialize()`는 이 단계에 이어 v3의 적용 시작일도 추가합니다. v2에서는 v1 이전을 반복하지 않고 v3 단계만 실행하며, v3에서는 이전을 다시 하지 않습니다. 더 높은 버전은 임의로 낮추지 않습니다.

하나의 `BEGIN IMMEDIATE` 안에서 다음을 처리합니다.

1. `timetable_presets(id, name, isDefault, createdAt, updatedAt)`를 만들고 `기본 시간표 1`을 기본값으로 만듭니다.
2. 기존 `templates`의 각 블록에 새 `presetId`를 부여합니다. 임시 v2 테이블에 모든 기존 필드를 복사한 뒤 교체하여 `presetId NOT NULL`과 실제 외래 키를 적용합니다. 기존 블록 ID·제목·요일·시간·색상·생성 및 수정 시각은 유지합니다.
3. `events`, `initialized_weeks`의 기존 데이터는 변경하지 않습니다. 날짜별 일정의 `templateId`는 원본 추적용이며 삭제 cascade와 연결하지 않습니다.
4. 기본 선택에 `WHERE isDefault = 1`인 UNIQUE 인덱스를 적용합니다. 기본 선택은 0개 또는 1개입니다. 템플릿 블록에만 preset 삭제 cascade를 적용합니다.
5. 다중 시간표 구조는 v2이며, 현재 버전에서는 아래 v3 단계까지 같은 트랜잭션에서 마친 후 전체 스냅샷을 읽고 커밋합니다. 중간 쓰기·조회 실패 시 DDL과 데이터 및 버전을 모두 롤백하고 재시도할 수 있습니다.

## SQLite v2 → v3 및 적용 시작일

`timetable_presets.applyFromWeek`를 nullable TEXT 열로 추가합니다. v2의 일정·시간표·주 기록 및 기존 필드는 변경하지 않습니다. 기본 지정 시 다음 주 월요일을 저장하고 `ensureWeek()`는 해당 주 이상이면서 미초기화·수동 일정 없음 조건까지 만족할 때만 복사합니다. 기존 버전의 지정일은 기록되어 있지 않으므로 업그레이드 다음 주를 기준으로 삼아 과거·현재 주의 자동 생성을 방지합니다. 자세한 정책과 초기화 기능은 [초기화·자동 적용 문서](RESET_AND_APPLY.md)에 있습니다.

새 주의 초기화는 활성 기본 preset에 속하는 블록만 복사합니다. 이미 초기화된 주는 덮어쓰지 않습니다. 기본 선택이 없으면 빈 주를 기록합니다. 직접 작성한 일정이 있는 주도 보호하며, 날짜별 일정 생성·붙여넣기·삭제 시 주 기록을 남겨 마지막 일정을 지운 뒤에도 기본 일정이 다시 나타나지 않게 합니다.

시간표 가져오기는 원본 조회 → 대상 블록 삭제 → 새 ID·새 시각으로 삽입 → 전체 스냅샷 → 커밋을 한 트랜잭션으로 실행합니다. 다른 preset, 날짜별 원본, 이미 생성된 주간 사본은 변경하지 않습니다. 기본 선택·시간표 삭제도 같은 직렬 트랜잭션 경로를 사용합니다.

## 변경 파일

수정:

- `src/app/_layout.tsx`, `src/app/default-timetable.tsx`, `src/app/settings.tsx`
- `src/components/timetable/event-block.tsx`, `context-menu.tsx`, `timetable-grid.tsx`, `planning-screen.tsx`
- `src/hooks/use-calendar.tsx`
- `src/lib/repository.ts`, `src/lib/context-menu.ts`, `src/types/calendar.ts`
- `tests/calendar.test.cjs`, `tests/timetable-ui.test.cjs`, `tests/ui-harness.cjs`, `tsconfig.tests.json`
- `README.md`, `docs/TOUCH_TESTS.md`

추가:

- `src/app/preset-editor.tsx`, `src/app/import-timetable.tsx`
- `src/components/timetable/preset-list.tsx`, `preset-editor.tsx`, `import-timetable.tsx`
- `src/components/ui/confirmation-dialog.tsx`, `choice-sheet.tsx`
- `src/lib/presets.ts`, `tests/presets.test.cjs`, `docs/PRESETS_MIGRATION.md`

기존 `database.ts`는 같은 DB 파일을 엽니다. 저장소의 초기화 단계에서 이전을 수행하므로 DB 이름이나 경로를 바꾸지 않습니다. `timetable.ts`의 이동·공유 경계선 순수 계산도 유지합니다. 런타임 및 개발 의존성 변경은 없습니다.

## 검증

필수 명령: `npm run typecheck`, `npm run lint`, `npm test`, `npx expo install --check`.

2026-11-10 실행 결과: TypeScript 통과, ESLint 통과, 자동 테스트 65/65 통과, Expo 의존성 검사 `Dependencies are up to date`. 추가로 iOS·Android Hermes 및 웹 전체 번들 생성도 성공했습니다. 패키지 버전은 변경하지 않았습니다.

자동 테스트는 기존 회귀 테스트와 실제 SQLite의 v1 이전·이전 실패 복구, 다중 preset 분리, 이름 충돌 회피, 기본 선택 단일성, 미초기화 주에만 적용, 불러오기·복제 및 새 ID, 교체 실패·스냅샷 실패 전체 롤백, 삭제 후 사본 보존, 파일 재시작 복원을 포함합니다. 실제 React 컴포넌트 테스트는 누름·해제·화면 이탈의 애니메이션 상태, 복사·삭제 확인, 일관된 헤더, 읽기 전용 미리보기, 생성·편집·불러오기 화면과 Provider 연결을 확인합니다.

네이티브 표면·애니메이션 실행기·제스처 전달은 테스트 대역입니다. 실제 iPhone의 프레임 부드러움, 제스처 경쟁, 햅틱과 시스템 글꼴의 시각적 크기는 [실기기 체크리스트](TOUCH_TESTS.md)로 확인해야 합니다.
