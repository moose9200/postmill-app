import { describe, it, expect, vi } from 'vitest';
import {
  fetchGithubActivity,
  parseChangelog,
  REPO_PATTERN,
} from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.github';

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed
- Canvas plays videos.

## [1.3.0] - 2026-10-21

### Added
- Timeline editor.

## [1.2.0] - 2026-10-01
- Older.

## [1.1.0] - 2026-09-01
- Oldest, beyond the 3-section cap.
`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('REPO_PATTERN', () => {
  it('accepts owner/name and rejects dot segments that would escape /repos/', () => {
    for (const ok of ['acme/app', 'socketio/socket.io', 'a-b/c_d.e']) expect(REPO_PATTERN.test(ok)).toBe(true);
    // "../.." would resolve https://api.github.com/repos/../../commits to /commits.
    for (const bad of ['../..', 'acme/..', 'acme/.', '../app', 'a/b/c', 'acme app/x', 'acme/']) expect(REPO_PATTERN.test(bad)).toBe(false);
  });
});

describe('parseChangelog', () => {
  it('returns the newest 3 sections with dates and content-hashed ids', () => {
    const out = parseChangelog(CHANGELOG, 'acme/app');
    expect(out.map((a) => a.title)).toEqual([
      'Changelog [Unreleased]',
      'Changelog [1.3.0] - 2026-10-21',
      'Changelog [1.2.0] - 2026-10-01',
    ]);
    expect(out[1].occurredAt.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(out[1].body).toContain('Timeline editor.');
    // Editing a section changes its id so it re-surfaces.
    const edited = parseChangelog(CHANGELOG.replace('Canvas plays', 'Canvas now plays'), 'acme/app');
    expect(edited[0].externalId).not.toBe(out[0].externalId);
    expect(edited[1].externalId).toBe(out[1].externalId);
  });
});

describe('fetchGithubActivity', () => {
  const since = new Date('2026-10-10T00:00:00Z');

  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/commits')) {
      return json([
        { sha: 'a1', html_url: 'https://g/c/a1', commit: { message: 'Fix login race\n\nDetails here', author: { date: '2026-10-20T10:00:00Z' } } },
        { sha: 'b2', html_url: 'https://g/c/b2', commit: { message: 'feat: timeline (#259)', author: { date: '2026-10-21T10:00:00Z' } } },
        { sha: 'c3', html_url: 'https://g/c/c3', commit: { message: 'Merge pull request #7 from x/y', author: { date: '2026-10-21T10:00:00Z' } } },
      ]);
    }
    if (url.includes('/pulls')) {
      return json([
        { number: 259, title: 'Timeline', body: 'Adds a timeline', merged_at: '2026-10-21T10:00:00Z', html_url: 'https://g/p/259' },
        { number: 200, title: 'Closed unmerged', body: null, merged_at: null, html_url: 'https://g/p/200' },
        { number: 100, title: 'Merged long ago', body: null, merged_at: '2026-09-01T00:00:00Z', html_url: 'https://g/p/100' },
      ]);
    }
    if (url.includes('/releases')) {
      return json([
        { id: 9, tag_name: 'v1.3.0', name: 'v1.3.0', body: 'Notes', published_at: '2026-10-21T00:00:00Z', html_url: 'https://g/r/9', draft: false },
        { id: 8, tag_name: 'v1.4.0', name: null, body: '', published_at: null, html_url: 'https://g/r/8', draft: true },
      ]);
    }
    return new Response(CHANGELOG, { status: 200 });
  });

  it('maps commits, merged PRs, published releases and changelog sections', async () => {
    const out = await fetchGithubActivity(fetcher as any, 'acme/app', since, 'tok');

    const byKind = (k: string) => out.filter((a) => a.kind === k);
    // PR squash/merge commits are skipped — their PR represents them.
    expect(byKind('commit').map((a) => a.externalId)).toEqual(['acme/app:commit:a1']);
    expect(byKind('commit')[0]).toMatchObject({ title: 'Fix login race', body: 'Details here' });
    expect(byKind('pull_request').map((a) => a.title)).toEqual(['#259 Timeline']);
    expect(byKind('release').map((a) => a.externalId)).toEqual(['acme/app:release:9']);
    expect(byKind('changelog')).toHaveLength(3);

    const [url, init] = fetcher.mock.calls[0] as any;
    expect(url).toBe(`https://api.github.com/repos/acme/app/commits?since=${since.toISOString()}&per_page=50`);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'User-Agent': 'postmill-build-log',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    const changelogCall = fetcher.mock.calls.find(([u]) => (u as string).includes('/contents/')) as any;
    expect(changelogCall[1].headers.Accept).toBe('application/vnd.github.raw+json');
  });

  it('sends no Authorization header without a token and tolerates a missing CHANGELOG', async () => {
    const f = vi.fn(async (url: string) =>
      url.includes('/contents/') ? new Response('', { status: 404 }) : json([])
    );
    const out = await fetchGithubActivity(f as any, 'acme/app', since);
    expect(out).toEqual([]);
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
  });

  it('throws a status-specific, readable error when the repo is not reachable', async () => {
    const at = (status: number) => vi.fn(async () => new Response('', { status }));
    await expect(fetchGithubActivity(at(404) as any, 'acme/nope', since)).rejects.toThrow(/acme\/nope was not found on GitHub/);
    await expect(fetchGithubActivity(at(401) as any, 'acme/app', since)).rejects.toThrow(/rejected the token/);
    await expect(fetchGithubActivity(at(403) as any, 'acme/app', since)).rejects.toThrow(/rate limit or access denied/);
    await expect(fetchGithubActivity(at(502) as any, 'acme/app', since)).rejects.toThrow(/GitHub returned 502/);
  });
});
