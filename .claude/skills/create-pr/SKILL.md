---
name: create-pr
description: Create a pull request with a structured description including summary, validation plan with checkboxes, E2E test commands for deployed environments, and deployment checklist. Use this skill when creating or updating a PR.
---

# Create Pull Request

When creating a PR for this project, follow this format strictly.

## Pre-flight

Before creating the PR:
1. Ensure `npm run lint` passes with zero warnings
2. Ensure `npm run type-check` passes
3. Ensure `npm run build` succeeds
4. Ensure E2E tests pass locally: `npx playwright test`
5. Check that the branch is up to date with `main`

## PR Description Format

Use this template:

```markdown
## Summary

<1-3 bullet points describing what this PR does and why>

## Changes

<List of notable changes, grouped by area (API, UI, DB, infra, tests)>

## Validation Plan

### Automated
- [ ] CI passes (lint + type-check + build + E2E)

### Manual (on preview environment)
<Checkboxes for each manual validation step. Be specific about what to check and where.>

**Every URL or path must be a clickable Markdown link** so the reviewer can jump straight to the page from GitHub. Use the full preview URL, not bare paths or backticks.

- [ ] Open [`/games`](https://on-board-preview.jolelievre.com/games) → page loads correctly
- [ ] Check [`/api/health`](https://on-board-preview.jolelievre.com/api/health) responds with `{"status":"ok",...}`
- [ ] <Feature-specific validation steps...>

### E2E on deployed preview

Run E2E tests against the preview environment:

```bash
BASE_URL="https://on-board-preview.jolelievre.com" npm run test:chrome
```

## Checklist

- [ ] No `any` types introduced
- [ ] No ESLint warnings
- [ ] E2E tests added/updated for new functionality
- [ ] CLAUDE.md updated if conventions changed
- [ ] PLAN.md updated if phase progress changed

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Rules

- **Always ask for user approval** before creating or updating a PR
- Keep the PR title short (under 70 characters), use conventional commit prefix (`feat:`, `fix:`, `chore:`, etc.)
- The validation plan is the primary QA step — make it thorough and actionable
- When the PR adds user-facing features, include specific steps to test them on the preview environment
- **Make every URL/path in the validation plan a clickable Markdown link** pointing to the preview environment (`https://on-board-preview.jolelievre.com/...`). Bare paths or backtick-wrapped paths force the reviewer to copy-paste — clickable links don't.
- Adapt the checklist to the scope of the PR (remove items that don't apply, add relevant ones)
- **For offline-related validation, instruct the reviewer to physically toggle WiFi (or airplane mode), NOT to use Chrome DevTools' "Offline" Network throttle.** Chrome DevTools does not reliably fire `online`/`offline` window events on a hard refresh, which makes our `navigator.onLine`-based detection lag or misbehave in that mode. The app targets real-world connectivity loss, and that is what the validation must exercise.
