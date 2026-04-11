# CLAUDE.md

Цей файл містить правила для Claude Code при роботі в цьому репозиторії.

## Про проект

VS Code розширення **Claude Git Commit** — генерує повідомлення комітів через Claude AI (CLI або API). Публікується в VS Code Marketplace під publisher `ZakhariiMelnyk`.

- Точка входу: [src/extension.ts](src/extension.ts)
- Білд: webpack → [dist/extension.js](dist/extension.js)
- Пакування: `vsce` → `.vsix`

## Коміти — Conventional Commits (обов'язково)

Release workflow парсить коміти й групує release notes **за префіксом**. Будь-який коміт без правильного префіксу потрапить у "📦 Other" або буде проігнорований.

**Дозволені префікси** (розпізнає [.github/workflows/release.yml](.github/workflows/release.yml)):

| Префікс | Секція в release notes |
|---|---|
| `feat:` / `feature:` | ✨ Features |
| `fix:` | 🐛 Bug Fixes |
| `perf:` | ⚡ Performance |
| `refactor:` | ♻️ Refactoring |
| `docs:` | 📝 Documentation |
| `chore:` / `build:` / `ci:` | 🔧 Chores |

**Правила:**
- Scope в дужках заохочується: `fix(cli): ...`, `feat(prompts): ...`
- Мова повідомлення — українська (див. попередні коміти), але префікс англійською
- **НЕ** створювати коміти виду `1.0.17` вручну — це робить release workflow. Коміти, що починаються з цифри, ігноруються парсером нотаток
- Merge-коміти виключені з нотаток (`--no-merges`)
- Ніколи не використовувати `--no-verify`, `--amend` на запушених комітах, `git push --force` без явної вказівки користувача

## Випуск нової версії

**НЕ робити вручну** крім випадків, коли користувач прямо просить. Стандартний флоу:

1. Переконатися що `main` чистий і CI зелений
2. Підняти версію: `npm version patch|minor|major --no-git-tag-version`
3. Зробити коміт версії (виняток із правила conventional commits — формат `X.Y.Z`, як у попередніх релізах)
4. Створити тег: `git tag vX.Y.Z`
5. Запушити: `git push && git push origin vX.Y.Z`
6. GitHub Actions [release.yml](.github/workflows/release.yml) автоматично:
   - Збере `.vsix`
   - Згенерує release notes з комітів від попереднього тегу
   - Створить GitHub Release з прикріпленим `.vsix`
   - Опублікує в Marketplace (якщо секрет `VSCE_PAT` налаштований)

**Альтернатива:** ручний запуск через `workflow_dispatch` в GitHub UI з полем `version`.

**Semver:**
- `patch` — баг-фікси, зміни без впливу на API/поведінку
- `minor` — нові фічі, зворотньо сумісні
- `major` — breaking changes (змінені команди, налаштування, поведінка за замовчуванням)

## GitHub Actions

Два workflow:

### [.github/workflows/ci.yml](.github/workflows/ci.yml)
Запускається на PR та пуш в `main`. Робить: `npm ci` → lint → `npm run package` → dry-run `vsce package`. Артефакт `.vsix` зберігається 7 днів. **Не ламати цей пайплайн** — якщо lint/build падає, виправляти, а не обходити.

### [.github/workflows/release.yml](.github/workflows/release.yml)
Тригери:
- Пуш тегу `v*.*.*`
- Ручний запуск (`workflow_dispatch`) з параметрами `version` і `publish`

Workflow сам синхронізує `package.json` з версією тегу через `npm version --no-git-tag-version`, якщо вони розходяться. Це означає: **якщо ти підняв версію вручну перед тегом — це ок, якщо ні — workflow підтягне сам**.

**Секрети:**
- `VSCE_PAT` — токен для публікації в Marketplace. Якщо не встановлений, workflow лише створить GitHub Release з warning'ом, не впаде.
- `GITHUB_TOKEN` — вбудований, використовується `softprops/action-gh-release` для створення релізу.

### Правила модифікації workflow
- Будь-які зміни в `.github/workflows/**` комітити з префіксом `ci:`
- Не додавати кроки, які роблять `git push` назад у репо без явної потреби (створює ризик інфінітних циклів)
- Якщо змінюєш логіку генерації release notes — переконайся, що парсер коректно обробляє всі 6 типів conventional commits і не ламається на порожньому range (перший реліз)
- Тестувати workflow можна через `workflow_dispatch` перед тим як виливати через тег

## Білд і пакування вручну

```bash
npm run package              # webpack production build
npx vsce package             # створити .vsix
```

Результат — `claude-git-commit-X.Y.Z.vsix` в корені. `.vsix` файли **закомічені в репозиторій** (історичні релізи) — нові додавати тільки якщо випускаєш вручну без CI.

## Файли, яких НЕ чіпати без потреби
- `package.json` поле `version` — керується релізним процесом
- `.vscodeignore` — впливає на розмір пакета, перевіряти тест-пакуванням після змін
- Історичні `.vsix` в корені — не видаляти без прохання користувача

## Мова
Відповіді користувачу — українською. Префікси комітів, назви змінних, код — англійською.
