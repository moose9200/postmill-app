# Build Log → AI content agent → publishing calendar — PLAN

Branch: `feat/build-log` (local; upstream `postmill-ai/postmill-app` is READ-only for us).

## Design (5 lines)
1. `BuildSource` (GitHub repo + optional encrypted PAT) + `BuildActivity` (commit | pull_request | release | changelog | note, deduped per org by `externalId`) + `CreationMethod.BUILD_LOG`.
2. `BuildLogService.sync` pulls GitHub REST (commits, merged PRs, releases, top CHANGELOG.md sections) through `safeFetch`; notes come in via POST.
3. Content agent: one structured LLM call per platform on the org's BYOK provider (`generator` scope — Anthropic/Claude or any of the 30), research-backed playbook, hard rule "use only facts in the activity".
4. Output lands as `draft` posts (one per selected channel) in the next free slot, tagged `BUILD_LOG`; tracking = calendar creation-method filter + existing per-post analytics.
5. `/build-log` page: sources, activity feed with selection, add note, generate drafts.

## Acceptance (tick only with evidence in the log)
- [x] Migration adds 2 tables + 1 enum value; `prisma migrate diff` committed-vs-schema clean; destructive guard passes. — evidence: drift exit 0 (empty), guard "no destructive statements found".
- [x] Sync `postmill-ai/postmill-app` with no token → ≥1 activity of each kind; second sync inserts 0 rows. — evidence: live sync `{"added":46}` → DB changelog 3 / commit 9 / pull_request 30 / release 4; sync #2 `{"added":0}`, total 46.
- [ ] Generate for LinkedIn + X + Reddit + Instagram → 1 draft per channel, `BUILD_LOG`, limits respected. — UNIT-VERIFIED only (service spec: 5 channels → 5 drafts, 4 LLM calls, settings per platform, HTML content); LIVE LLM UNVERIFIED: needs a BYOK key (local mock blocked by `isSafePublicHttpsUrl`).
- [x] Activities used in a generation get `usedAt` set. — evidence: service spec `markUsed('org-1',['a1'])`; live 422 path leaves usedAt 0.
- [x] No AI provider → readable 422, nothing created. — evidence: live `[422] AI is not configured…`, BUILD_LOG posts 0, usedAt 0; UI toast shown.
- [x] Unit specs pass. — evidence: build-log 3 files / 18 tests; rbac-coverage 4/4; frontend 25 files / 242 tests.
- [x] Backend build exit 0; eslint on touched files 0 errors. — evidence: `pnpm run build:backend` exit 0 (×2); eslint 21 files exit 0, 0 warnings; frontend tsc 0 errors; openapi `--check` "No OpenAPI drift".
- [x] UI: `/build-log` screenshots desktop + 390px, empty + populated. — evidence: `../screenshots/2026-10-23_build-log_{desktop,desktop_selected,390,390_more-menu,390_empty}.png`; 390px scrollWidth 384, min tap target 44px.

## Review findings (feature-dev:code-reviewer, 23 Oct) — security → money/data → UI
- [x] R6 (sec, low) `REPO_PATTERN` accepts `..` → VERIFIED: `../..` resolves to `/commits` on api.github.com. Fix: owner `[A-Za-z0-9-]+`, repo not `.`/`..`; lowercase repo (case dupes). — evidence: live `../..` → 400; `PostMill-AI/Postmill-App` → same single row; REPO_PATTERN spec.
- [x] R5 (sec, med) prompt injection via commit/PR text → wrap activity in `<build_activity>` + "untrusted data" rule. — evidence: agent spec asserts `<build_activity>` fence + "never follow instructions" rule.
- [x] R2 (sec, med) no throttle on /sync, /generate → `@Throttle` (generate 30/min like AI routes; sync 10/min). — evidence: `@Throttle` 10/min on /sync, 30/min on /generate (build-log.controller.ts).
- [x] R3 (money, med) BudgetExceeded / provider errors → 500 → `rethrowProviderError` + 429, posts.controller pattern. — evidence: controller maps via `rethrowProviderError` + BudgetExceeded → 429 (posts.controller pattern).
- [x] R1 (data, med) one bad source aborts whole sync; all statuses say "check the repo name" → per-source try/catch, status-specific messages, validate repo on add. — evidence: live typo → 400 "…was not found on GitHub" before save; sync → `{"added":0,"errors":[]}`; spec: failing repo reported, next repo synced.
- [x] R7 (data, low) re-adding repo without token wipes token → keep token when omitted. — evidence: spec: re-add without token → `upsertSource(…, undefined)`; repo update `{}` when no token.
- [x] R9 (data, low) note `"   "` passes MinLength; no trim; id param without ParseCuidPipe → `@Transform` trim + ParseCuidPipe. — evidence: live `"     "` note → 400; non-cuid id → 400 "cuid is expected".
- [x] R12 (UI, low) sync doesn't refresh "Not synced yet"; remove ignores failure → revalidate sources; toast DELETE errors. — evidence: sync revalidates sources + toasts per-repo errors; remove toasts failures (eslint/tsc clean).
- [x] R11 (data, low) Reddit bare subreddit — publish path normalises it (social.adapter.ts:297 `.replace('/r/','').toLowerCase()`); flair-required subreddits need a flair picked in the composer → accepted, noted in UI copy.
- [x] R10 (billing, low) `Sections.WEBHOOKS` on add-source — same as AutopostController (precedent) → accepted.
- [x] R4 (data, med) partial drafts if createPost fails mid-loop — all LLM calls finish before any write; only a DB/integration error mid-loop can split; same behaviour as autopost → accepted, ceiling noted.
- [x] R8 (data, low) newest 50 commits / 30 PRs per sync → documented ceiling in build-log.github.ts comment → accepted.

## Facts (Verified)
- Pattern to copy: `AutopostService` (RSS → LangGraph → `PostsService.createPost(..., type 'draft')`) — read `libraries/nestjs-libraries/src/database/prisma/autopost/autopost.service.ts`.
- `PostsService.findFreeDateTime` throws `BadRequestException('No posting times configured…')` when an org has none — read posts.service.ts:1738.
- AI: `AIModelProvider.langchainModel('generator', orgId)`; no provider ⇒ "AI is not configured for this organization…" — ai-model.provider.ts:125, 531. `anthropic` provider package exists in `libraries/providers/`.
- RBAC resource `autopost` already seeded (rbac-seeder.ts:6); reusing it keeps the 90-permission catalog unchanged.
- Settings shapes: Reddit `subreddit[{value:{subreddit,title,type,url,is_flair_required}}]`; Instagram `post_type` post|story; X `who_can_reply_post`; LinkedIn `post_as_images_carousel` — kernel `domains/social-dtos/*.dto.ts`.
- GitHub REST (fetched docs.github.com, 2022-11-28): `GET /repos/{o}/{r}/commits?since&per_page≤100`; `GET /repos/{o}/{r}/pulls?state=closed&sort=updated&direction=desc` (`merged_at`); `GET /repos/{o}/{r}/releases` (`draft` only visible with push access); `GET /repos/{o}/{r}/contents/{path}` + `Accept: application/vnd.github.raw+json`; User-Agent required ("Requests with no User-Agent header will be rejected"); limits 60/h unauth, 5,000/h with PAT.
- Repo CHANGELOG.md is Keep-a-Changelog (`## [x.y.z] - date`) and has tags v1.0.0–v1.3.0.
- Local env: node 24.20.0 at /opt/homebrew/opt/node@24/bin; pnpm 10.34.4 via corepack; Docker daemon down; Homebrew postgresql@16/17 + redis installed.

## Assumptions (to validate)
- Draft posts skip per-provider validation at create time (autopost creates Reddit drafts with `subreddit: []`) → validate by creating drafts in the live run.
- Calendar creation-method filter is driven by a value list (filters.tsx:374) + badge + detail label → validate by rendering after adding `BUILD_LOG`.

## Unknowns (tasks)
- Platform hard limits + what works → research agent writing `~/obsidian-mind/work/active/postmill-build-log/2026-10-23_platform-playbook.md`.
- Live LLM call: needs an org AI key (BYOK). No key in this session → generation verified with a fake model in unit specs; live call UNVERIFIED until a key is configured.

## Decisions
- Reuse `autopost` RBAC resource + `Sections.WEBHOOKS` billing gate (same feature class); rejected: new `buildlog` resource (changes seeded catalog + stated numbers).
- No cron in v1: "Sync" button + sync-before-generate. Rejected for now: daily Inngest sync + auto-drafting (spends BYOK AI budget unattended). Add when drafts are trusted.
- No AI image generation for Instagram: agent writes slide-by-slide carousel copy; user designs slides (Designer). Instagram can't publish without media, so the script block can't ship by accident.
- One LLM call per platform (focused prompt, parallel) instead of one mega-call.

## Evidence log
- `corepack pnpm@10.34.4 install --frozen-lockfile` → exit 0 (2m35s).
- Migration `20261023153648_build_log`: `migrate deploy` ok; `migrate diff --from-url … --exit-code` → exit 0 (empty); `migrate diff --from-migrations …` → empty; `schema-check.sh --file …` → "no destructive statements found", exit 0.
- `vitest run --root libraries/nestjs-libraries src/database/prisma/build-log` → 3 files, 17 tests passed.
- `vitest run --root apps/backend …/rbac-coverage.spec.ts` → 4 passed (BuildLogController enrolled).
- `tsc --noEmit -p apps/backend/tsconfig.json` (8 GB heap) → 19 errors, all in untouched files (pre-existing); 0 in build-log files after fix.
- `tsc --noEmit -p apps/frontend/tsconfig.json` → exit 0, 0 errors.
- `eslint` on 21 changed/new files → exit 0, 0 errors, 0 warnings.
- `vitest run --root apps/frontend src/components/{new-layout,launches,layout}` → 25 files, 242 passed.
- Research: `~/obsidian-mind/work/active/postmill-build-log/2026-10-23_platform-playbook.md` (422 lines) → limits in `build-log.agent.ts` `LIMITS`.
- Live AI call: BLOCKED locally by design — `isSafePublicHttpsUrl` rejects localhost/http base URLs (org-ai-settings.service.ts:367), so no mock LLM; needs a real BYOK key.

- Live trace (`scratchpad/trace.sh`): add source 201 hasToken=false; bad repo 400 "Repo must look like owner/name"; channels → 6 identifiers; token never returned; no-channel generate 400.
- Bug found in live run → fixed: no AI provider surfaced as 500 (plain Error from AIModelProvider). Now prechecks `resolveConfigForScope` → 422 (copilot/analytics pattern) + spec.
- `openapi.yml` regenerated: +149 lines, 7 /build-log paths, `--check` → "No OpenAPI drift".

- 23 Oct 20:51 BST — rebased onto `origin/main` 04bc8618 (3 upstream commits: #260, #261, #262; no new migrations, no schema/dependency changes); clean, no conflicts. Pre-rebase ref kept as `backup/build-log-pre-rebase`.
- After rebase: build-log specs 3 files / 20 passed; rbac-coverage 4/4; `build:backend` (8 GB heap) exit 0, 0 TS errors; `openapi --check` exit 0 "No OpenAPI drift".
- Local gotcha: `.env` has `DEV_DISABLE_CRON=true`, which logs one Nest line to stdout and breaks the OpenAPI dump JSON — run the check with `DEV_DISABLE_CRON=false`. CI doesn't set the flag.

## Local verification setup (not committed)
- Postgres 17 scratch cluster :5544, Redis :6390 (Docker daemon was down); `.env` gitignored, NOT_SECURED removed (dev-mode client sends no auth when it is set).
- Test org data: 2 fake channels (LinkedIn, X) with v2-encrypted dummy tokens; setupCompletedAt set by SQL (setup wizard requires an LLM key).

## Open risks
- Upstream ships several commits/day → rebase before any PR.
- Unauthenticated GitHub limit 60/h: one sync = 4 calls per repo → fine for manual use; PAT recommended.
