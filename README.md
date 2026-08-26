# my-agents

개인용 에이전트 스킬 모음과 이를 설치·관리하는 CLI.

## 구조

```
skills/    에이전트 스킬 (SKILL.md 단위)
plugins/   에이전트 플러그인
cli/       devookim-skills — 이 레포의 스킬을 설치하는 CLI (npm: devookim-skills)
```

## 스킬 설치

```sh
bunx devookim-skills find              # 스킬 목록 조회
bunx devookim-skills add <skill>       # 설치
bunx devookim-skills update            # 업데이트
bunx devookim-skills remove <skill>    # 삭제
```

push 전 현재 체크아웃을 설치할 때는 저장소 루트에서 `--local`을 사용합니다.

```sh
bunx devookim-skills add <skill> --local -g -y
```

저장소의 `skills-lock.json`은 vendoring 전용이므로 `my-agents` 내부에서 `add`할
때는 `-g`가 필요합니다. 프로젝트 범위 설치는 설치할 프로젝트 디렉터리에서 실행합니다.

## 외부 스킬 vendoring

외부 스킬은 실제 파일을 `skills/`에 보관하고, 원본 저장소·커밋·경로·해시는
`skills-lock.json`에 기록합니다.

```sh
bunx devookim-skills vendor add <source> -s <skill>
bunx devookim-skills vendor list
bunx devookim-skills vendor check [skill...]
bunx devookim-skills vendor update [skill...]
```

로컬 수정과 upstream 수정이 겹치면 3-way merge 충돌을 해결한 뒤 완료합니다.

```sh
bunx devookim-skills vendor continue <skill>
```

저장소 경로는 다음 우선순위로 결정됩니다.

1. `--repo <path>`
2. `DEVOOKIM_SKILLS_REPO`
3. 현재 디렉터리부터 상위 탐색

```sh
export DEVOOKIM_SKILLS_REPO="$HOME/Dev/settings/my-agents"
```

자세한 사용법은 [cli/README.md](cli/README.md) 참고.

[vercel-labs/skills](https://github.com/vercel-labs/skills)를 직접 써도 됩니다:

```sh
npx skills add DevooKim/my-agents -s <skill>
```
