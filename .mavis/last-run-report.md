# Pathfinder-AI Health Check — 2026-07-29 06:00 UTC

## PRs Inspected: #1417–#1417 on harshdwivediiiii/pathfinder-ai

> Note: PRs #1417–#1421 are on `harshdwivediiiii/pathfinder-ai` (upstream), not `tmdeveloper007/pathfinder-ai` (fork).
> Repo tree: `harshdwivediiiii/pathfinder-ai` (upstream, 97 forks) ← `tmdeveloper007/pathfinder-ai` (fork)

---

## PR Status Summary

| PR  | Title | State | CI Status |
|-----|-------|-------|-----------|
| #1417 | fix: corrected broken import path in tests/ats.test.mjs | **MERGED** | RED — `build (22.x)` + `build-and-push-docker-image` failed |
| #1418 | feat: added AbortController support to use-fetch hook | **MERGED** | RED — same |
| #1419 | test: added test coverage for lib/security/sanitize.js | **MERGED** | RED — same |
| #1420 | test: added test coverage for lib/schemas/issue.js | **MERGED** | RED — same |
| #1421 | fix: normalized lib/ai/ai-json.js to use getAiResponseText | **MERGED** | RED — same |

All 5 branches were **deleted after merge** — no branch exists to force-push to.

---

## Root Cause

All RED CI failures trace to a single flaky test:

```
FAIL  tests/roadmap.test.mjs > generateCareerRoadmap > generates a career roadmap successfully
Error: Test timed out in 5000ms.
```

- Vitest's **default timeout is 5000ms**
- The test passes locally in **~1600–1900ms**
- GitHub Actions runners under shared load exceed 5s → test times out
- When `npm run test:unit` fails, the subsequent `npm run build` and `npm run test:e2e` steps are **skipped**, causing the full job to fail

The `build-and-push-docker-image` failure is a cascading effect — both `build (22.x)` and Docker CI share the same test-failure gate.

---

## Fix Applied

**PR #1474** — [https://github.com/harshdwivediiiii/pathfinder-ai/pull/1474](https://github.com/harshdwivediiiii/pathfinder-ai/pull/1474)

```
vitest.config.mjs: added testTimeout: 30000
```

All CI checks on PR #1474: ✅

| Check | Status |
|-------|--------|
| test | ✅ success |
| build (22.x) | ✅ success |
| build-and-push-docker-image | ✅ success |
| label (x2) | ✅ success |

---

## Pre-existing Main Branch Issues (NOT fixed by this PR)

These are ongoing infrastructure failures unrelated to PRs #1417–#1421:

| Workflow | Main Branch Status | Notes |
|----------|-------------------|-------|
| `Deploy Next.js site to Pages` | 🔴 failure | GitHub Pages deployment issue — check `pages.yml` secrets/config |
| `Docker CI` → `build-and-push-docker-image` | 🔴 failure | ghcr.io push issue — check GITHUB_TOKEN permissions or image name |
| `Node.js CI` | ✅ success | Fixed by PR #1474 |
| `Vercel` | ✅ success | External deployment |

---

## Next Steps

- **Merge PR #1474** to apply the timeout fix to main — this will clear the RED CI history
- **Investigate GitHub Pages deployment failure** on main — likely a `pages.yml` configuration or secret issue
- **Investigate Docker CI push failure** on main — likely a `GITHUB_TOKEN` permissions or `ghcr.io` registry issue
