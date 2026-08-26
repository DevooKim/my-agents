# devookim-skills

[DevooKim/my-agents](https://github.com/DevooKim/my-agents) 레포의 에이전트 스킬을 설치·관리하는 [vercel-labs/skills](https://github.com/vercel-labs/skills) 래퍼 CLI.

**Bun 전용입니다.** `bunx`로 실행하세요 (`npx` 미지원).

## 사용법

```sh
# 레포에 있는 스킬 목록 조회
bunx devookim-skills find

# 스킬 이름 없이 실행하면 목록 TUI에서 골라 설치
bunx devookim-skills add

# 스킬 설치 (여러 개 가능)
bunx devookim-skills add my-skill other-skill

# 레포의 전체 스킬 설치
bunx devookim-skills add --all

# 설치한 스킬 업데이트 (무인자: 이 도구로 설치한 전체)
bunx devookim-skills update [skill...]

# 설치한 스킬 삭제 (무인자: 이 도구로 설치한 전체)
bunx devookim-skills remove [skill...]

# 도움말
bunx devookim-skills help
```

## 대화형 선택

`add`, `update`, `remove`를 스킬 이름 없이 TTY에서 실행하면 스킬 목록 TUI가 열립니다.

```
설치할 스킬 선택 (DevooKim/my-agents)
  ↑/↓ 이동 · space 선택 · a 전체 · enter 확인 · esc 취소
❯ ◉ hello-devookim  devookim-skills 설치 파이프라인 검증용 샘플 스킬.
  ◯ writing-for-agents  Writing documents for agents.
```

- `add`는 소스 레포의 스킬을, `update`/`remove`는 이 도구로 설치한 스킬을 보여줍니다.
- `--all` 또는 `-y`를 주면 TUI 없이 바로 진행합니다. 파이프·CI 등 TTY가 아닌
  환경에서는 기존 동작(목록 출력 / 전체 대상)을 유지합니다.
- `vendor` 명령은 TUI를 사용하지 않습니다.

## 로컬 체크아웃

```sh
bunx devookim-skills add my-skill --local -g -y
```

`my-agents` 내부의 `skills-lock.json`은 vendoring 전용입니다. 저장소 안에서 설치할
때는 `-g`를 사용하고, 프로젝트 범위 설치는 대상 프로젝트 디렉터리에서 실행합니다.

`--local`과 `vendor` 명령은 `--repo`, `DEVOOKIM_SKILLS_REPO`, 현재 경로의 상위
순서로 `my-agents` 저장소를 찾습니다.

```sh
export DEVOOKIM_SKILLS_REPO="$HOME/Dev/settings/my-agents"
```

## 외부 스킬

```sh
# 파일을 skills/vendor/<name>/에 복사하고 skills-lock.json에 provenance 기록
bunx devookim-skills vendor add <source> -s <skill>

# 상태 및 upstream 변경 확인
bunx devookim-skills vendor list
bunx devookim-skills vendor check [skill...]

# 로컬 수정과 새 upstream을 3-way merge
bunx devookim-skills vendor update [skill...]

# 충돌 해결 완료
bunx devookim-skills vendor continue <skill>

# 파일과 lock entry 제거
bunx devookim-skills vendor remove <skill...> -y
```

## 동작 방식

- `add my-skill` → `bunx skills add DevooKim/my-agents -s my-skill` 위임
- `find` → `bunx skills add DevooKim/my-agents -l` 위임 (설치 없이 목록만)
- `remove` / `update` → skills CLI의 설치 기록(`skills-lock.json` / `~/.agents/.skill-lock.json`)에서
  소스가 `DevooKim/my-agents`인 스킬만 골라 위임합니다.
- `vendor` → 외부 원본을 `skills/vendor/`에 vendoring하고 저장소 루트의 `skills-lock.json`으로
  upstream commit과 최종 파일 해시를 추적합니다.
- 미인식 플래그(`-g`, `-y`, `-a`, `--copy` 등)는 skills CLI에 그대로 전달됩니다.
