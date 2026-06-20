type Tense = "imperative" | "past";

export function getGenerationPrompt(
  diff: string,
  stats: string,
  multiLine: boolean,
  commitStyle: string = "conventional",
  tense: Tense = "imperative"
): string {
  const diffContent = diff.slice(0, 6000);
  const styleInstructions = getStyleInstructions(commitStyle, multiLine, tense);

  if (multiLine) {
    return `git 변경사항을 분석하여 상세한 커밋 메시지를 생성하세요.

변경 통계:
${stats}

Diff (처음 6000자):
${diffContent}

${styleInstructions}

지정된 형식의 커밋 메시지만 반환하세요. 설명, markdown, 코드 블록(\`\`\`) 없이 순수 텍스트만 출력하세요.`;
  }

  return `git 변경사항을 분석하여 커밋 메시지를 생성하세요.

변경 통계:
${stats}

Diff (처음 6000자):
${diffContent}

${styleInstructions}

커밋 메시지(한 줄)만 반환하세요. 설명, markdown, 코드 블록(\`\`\`) 없이 순수 텍스트만 출력하세요.`;
}

function getTenseRules(tense: Tense): {
  instruction: string;
  wrong: string;
  right: string;
  verbs: string;
} {
  if (tense === "past") {
    return {
      instruction: "Subject는 과거형으로 작성 (무엇이 완료되었는지), 최대 50자, 마침표 없음",
      wrong: '잘못된 예: "기능 추가", "버그 수정", "스타일 업데이트"',
      right: '올바른 예: "기능 추가됨", "버그 수정됨", "스타일 업데이트됨"',
      verbs: "추가됨, 수정됨, 업데이트됨, 삭제됨, 리팩터링됨",
    };
  }
  return {
    instruction: "Subject는 명령형으로 작성 (동작을 명령하는 형식), 최대 50자, 마침표 없음",
    wrong: '잘못된 예: "기능 추가됨", "버그 수정됨", "스타일 업데이트됨"',
    right: '올바른 예: "기능 추가", "버그 수정", "스타일 업데이트"',
    verbs: "추가, 수정, 업데이트, 삭제, 리팩터링",
  };
}

function getStyleInstructions(style: string, multiLine: boolean, tense: Tense): string {
  const t = getTenseRules(tense);
  const past = tense === "past";
  const a = past ? "추가됨" : "추가";
  const b = past ? "수정됨" : "수정";
  const c = past ? "최적화됨" : "최적화";
  const d = past ? "업데이트됨" : "업데이트";
  const bodyImpl = past ? "구현됨" : "구현";
  const bodyAdd = past ? "추가됨" : "추가";
  const bodyUpd = past ? "업데이트됨" : "업데이트";

  switch (style) {
    case "conventional":
      return multiLine
        ? `응답 형식:
<type>(<scope>): <subject>

<body>

<footer>

규칙:
- ${t.instruction}
- Body: 변경 내용 상세 설명 (무엇을, 왜 변경했는지)
- Footer: Breaking changes, issue 참조
- Type: feat/fix/refactor/docs/style/test/chore/perf
- 동사 사용: ${t.verbs}

예시:
feat(auth): Google OAuth 제공자 ${a}

Google OAuth 2.0을 통한 인증 ${bodyImpl}.
토큰 처리 및 갱신 메커니즘 ${bodyAdd}.
새 제공자 지원을 위한 설정 ${bodyUpd}.

Closes #123`
        : `엄격한 규칙:
- 형식: <type>(<scope>): <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- 동사 사용: ${t.verbs}
- ${t.wrong}
- ${t.right}

예시:
feat(auth): Google OAuth 제공자 ${a}
fix(api): user endpoint 유효성 검사 오류 ${b}
refactor(store): 장바구니 상태 관리 ${c}
docs(readme): 설치 안내 ${d}`;

    case "prefix":
      return multiLine
        ? `응답 형식:
<type>: <subject>

<body>

<footer>

규칙:
- ${t.instruction}
- Body: 변경 내용 상세 설명 (무엇을, 왜 변경했는지)
- Footer: Breaking changes, issue 참조
- Type: feat/fix/refactor/docs/style/test/chore/perf
- 동사 사용: ${t.verbs}
- scope 괄호 없음

예시:
feat: Google OAuth 제공자 ${a}

Google OAuth 2.0을 통한 인증 ${bodyImpl}.
토큰 처리 및 갱신 메커니즘 ${bodyAdd}.

Closes #123`
        : `엄격한 규칙:
- 형식: <type>: <subject>
- Type: feat/fix/refactor/docs/style/test/chore/perf
- ${t.instruction}
- 동사 사용: ${t.verbs}
- scope 괄호 없음

예시:
feat: Google OAuth 제공자 ${a}
fix: user endpoint 유효성 검사 오류 ${b}
refactor: 장바구니 상태 관리 ${c}
docs: 설치 안내 ${d}`;

    case "default":
      return multiLine
        ? `응답 형식:
<subject>

<body>

<footer>

규칙:
- ${t.instruction}
- Body: 변경 내용 상세 설명 (무엇을, 왜 변경했는지)
- Footer: Breaking changes, issue 참조
- 동사 사용: ${t.verbs}
- TYPE 접두사 없음, scope 없음

예시:
Google OAuth 제공자 ${a}

Google OAuth 2.0을 통한 인증 ${bodyImpl}.
토큰 처리 및 갱신 메커니즘 ${bodyAdd}.

Closes #123`
        : `엄격한 규칙:
- 형식: type/scope 접두사 없는 단순 설명
- ${t.instruction}
- 동사 사용: ${t.verbs}
- TYPE 접두사(feat/fix 등) 없음, scope 없음

예시:
Google OAuth 제공자 ${a}
user endpoint 유효성 검사 오류 ${b}
장바구니 상태 관리 ${c}
설치 안내 ${d}`;

    default:
      return getStyleInstructions("conventional", multiLine, tense);
  }
}

export function getManagedPrompt(
  diff: string,
  stats: string,
  keepCoAuthoredBy: boolean,
  multiline: boolean,
  customPrompt: string,
  tense: Tense = "imperative"
): { systemPrompt: string; userPrompt: string } {
  const diffContent = diff.slice(0, 6000);

  const tenseRule =
    tense === "past"
      ? "- Subject는 한국어 과거형으로 작성, 최대 50자, 마침표 없음\n- 동사: 추가됨, 수정됨, 업데이트됨, 삭제됨, 리팩터링됨"
      : "- Subject는 한국어 명령형으로 작성, 최대 50자, 마침표 없음\n- 동사: 추가, 수정, 업데이트, 삭제, 리팩터링";

  let systemPrompt = `당신은 "Git 커밋 메시지 생성기" 함수입니다. 대화 능력이 없습니다. 순수 텍스트 커밋 메시지만 출력하세요.

규칙:
- 첫 번째 줄: <feat|fix|docs|style|refactor|test|build|ci|perf|chore|revert>(scope): <subject>
${tenseRule}
- markdown, 코드 블록, 코드 펜스(\`\`\`), 설명 금지`;

  if (multiline) {
    systemPrompt += `
- 빈 줄 이후 상세 설명 body 포함`;
  }

  if (keepCoAuthoredBy) {
    systemPrompt += `
- footer에 다음을 포함:
🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;
  }

  if (customPrompt) {
    systemPrompt += `
- 추가 요구사항: ${customPrompt}`;
  }

  const userPrompt = `변경 통계:
${stats}

Diff (처음 6000자):
${diffContent}`;

  return { systemPrompt, userPrompt };
}

export function getEditPrompt(currentMessage: string, userFeedback: string, diff: string, stats: string): string {
  return `현재 커밋 메시지:
${currentMessage}

사용자 피드백:
${userFeedback}

Git 변경사항:
${stats}

${diff.slice(0, 4000)}

사용자 피드백을 반영하여 커밋 메시지를 재생성하세요.
conventional commits 형식을 따르세요.
새 커밋 메시지만 반환하세요. 설명, markdown, 코드 블록 없이.`;
}
