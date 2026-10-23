import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export type ActivityKind = 'commit' | 'pull_request' | 'release' | 'changelog' | 'note';

export interface ActivityInput {
  kind: ActivityKind;
  externalId: string;
  title: string;
  body?: string;
  url?: string;
  occurredAt: Date;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// GitHub logins are alphanumeric + hyphen; a repo name may hold dots but never be "." or
// ".." — those would resolve api.github.com/repos/../.. outside /repos/.
export const REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;

// Caps keep one sync (and the prompt built from it) bounded. Each sync reads the newest
// 50 commits / 30 closed PRs / 10 releases: more than that between two syncs is skipped.
const BODY_MAX = 4000;
const CHANGELOG_SECTIONS = 3;

const firstLine = (s: string) => s.split('\n')[0].trim();
const rest = (s: string) => s.split('\n').slice(1).join('\n').trim();

// Keep-a-Changelog: one activity per "## " section, newest first. The body hash is in the
// id so an edited [Unreleased] section re-surfaces as new progress on the next sync.
export function parseChangelog(md: string, repo: string): ActivityInput[] {
  return md
    .split(/^## /m)
    .slice(1, 1 + CHANGELOG_SECTIONS)
    .map((section) => {
      const heading = firstLine(section);
      const body = rest(section).slice(0, BODY_MAX);
      const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      const hash = createHash('sha1').update(body).digest('hex').slice(0, 12);
      return {
        kind: 'changelog' as const,
        externalId: `${repo}:changelog:${heading}:${hash}`,
        title: `Changelog ${heading}`,
        body,
        url: `https://github.com/${repo}/blob/HEAD/CHANGELOG.md`,
        occurredAt: date ? new Date(date) : new Date(),
      };
    })
    .filter((a) => a.body);
}

// Squash/merge commits ("feat: x (#12)", "Merge pull request …") duplicate their PR.
const isPrCommit = (title: string) =>
  /\(#\d+\)$/.test(title) || title.startsWith('Merge ');

const githubError = (status: number, repo: string) =>
  status === 404
    ? `${repo} was not found on GitHub. Check the name, or add a token if it is private.`
    : status === 401
    ? `GitHub rejected the token for ${repo}.`
    : status === 403 || status === 429
    ? `GitHub rate limit or access denied for ${repo}. Add a token, or try again later.`
    : `GitHub returned ${status} for ${repo}.`;

// GET /repos/{repo}{path}. A missing file under /contents/ is null, not an error.
export async function githubGet(
  fetcher: Fetcher,
  repo: string,
  path: string,
  token?: string,
  accept?: string
) {
  const res = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'postmill-build-log',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404 && path.startsWith('/contents/')) {
    return null;
  }
  if (!res.ok) {
    throw new BadRequestException(githubError(res.status, repo));
  }
  return accept ? res.text() : res.json();
}

export async function fetchGithubActivity(
  fetcher: Fetcher,
  repo: string,
  since: Date,
  token?: string
): Promise<ActivityInput[]> {
  const get = (path: string, accept?: string) =>
    githubGet(fetcher, repo, path, token, accept);

  const iso = since.toISOString();
  const [commits, pulls, releases, changelog] = await Promise.all([
    get(`/commits?since=${iso}&per_page=50`),
    get('/pulls?state=closed&sort=updated&direction=desc&per_page=30'),
    get('/releases?per_page=10'),
    get('/contents/CHANGELOG.md', 'application/vnd.github.raw+json'),
  ]);

  const out: ActivityInput[] = [];

  for (const c of commits as any[]) {
    const title = firstLine(c.commit?.message || '');
    if (!title || isPrCommit(title)) continue;
    out.push({
      kind: 'commit',
      externalId: `${repo}:commit:${c.sha}`,
      title,
      body: rest(c.commit.message).slice(0, BODY_MAX) || undefined,
      url: c.html_url,
      occurredAt: new Date(c.commit.author?.date || Date.now()),
    });
  }

  for (const p of pulls as any[]) {
    if (!p.merged_at || new Date(p.merged_at) <= since) continue;
    out.push({
      kind: 'pull_request',
      externalId: `${repo}:pr:${p.number}`,
      title: `#${p.number} ${p.title}`,
      body: (p.body || '').slice(0, BODY_MAX) || undefined,
      url: p.html_url,
      occurredAt: new Date(p.merged_at),
    });
  }

  for (const r of releases as any[]) {
    if (r.draft || !r.published_at || new Date(r.published_at) <= since) continue;
    out.push({
      kind: 'release',
      externalId: `${repo}:release:${r.id}`,
      title: `Release ${r.name || r.tag_name}`,
      body: (r.body || '').slice(0, BODY_MAX) || undefined,
      url: r.html_url,
      occurredAt: new Date(r.published_at),
    });
  }

  return [...out, ...(changelog ? parseChangelog(changelog as string, repo) : [])];
}
