# devookim-skills

[DevooKim/my-agents](https://github.com/DevooKim/my-agents) 레포의 에이전트 스킬을 설치·관리하는 [vercel-labs/skills](https://github.com/vercel-labs/skills) 래퍼 CLI.

**Bun 전용입니다.** `bunx`로 실행하세요 (`npx` 미지원).

## 사용법

```sh
# 레포에 있는 스킬 목록 조회
bunx devookim-skills find

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

## 동작 방식

- `add my-skill` → `bunx skills add DevooKim/my-agents -s my-skill` 위임
- `find` → `bunx skills add DevooKim/my-agents -l` 위임 (설치 없이 목록만)
- `remove` / `update` → skills CLI의 설치 기록(`skills-lock.json` / `~/.agents/.skill-lock.json`)에서
  소스가 `DevooKim/my-agents`인 스킬만 골라 위임. 자체 상태 파일은 없습니다.
- 미인식 플래그(`-g`, `-y`, `-a`, `--copy` 등)는 skills CLI에 그대로 전달됩니다.
