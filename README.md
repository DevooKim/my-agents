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

자세한 사용법은 [cli/README.md](cli/README.md) 참고.

[vercel-labs/skills](https://github.com/vercel-labs/skills)를 직접 써도 됩니다:

```sh
npx skills add DevooKim/my-agents -s <skill>
```
