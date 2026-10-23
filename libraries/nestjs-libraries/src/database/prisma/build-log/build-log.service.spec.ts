import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.repository', () => ({
  BuildLogRepository: class {
    getSources = vi.fn();
    upsertSource = vi.fn();
    deleteSource = vi.fn();
    markSynced = vi.fn();
    addActivities = vi.fn().mockResolvedValue({ count: 0 });
    getActivities = vi.fn();
    getActivitiesByIds = vi.fn();
    markUsed = vi.fn();
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {
    getIntegrationsList = vi.fn();
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {
    findFreeDateTime = vi.fn();
    createPost = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    langchainModel = vi.fn();
    resolveConfigForScope = vi.fn().mockResolvedValue({ providerId: 'anthropic' });
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/brands/brands.service', () => ({
  BrandsService: class {
    getDefaultBrand = vi.fn().mockResolvedValue({ instructions: 'Plain, dry.' });
  },
}));
vi.mock('@postmill-ai/nestjs-libraries/encryption/encryption.service', () => ({
  EncryptionService: class {
    encrypt = vi.fn((v: string) => `enc(${v})`);
    decrypt = vi.fn((v: string) => v.slice(4, -1));
  },
}));
const { fetchGithubActivityMock, githubGetMock } = vi.hoisted(() => ({
  fetchGithubActivityMock: vi.fn(),
  githubGetMock: vi.fn(),
}));
vi.mock('@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.github', async (orig) => ({
  ...(await orig<any>()),
  fetchGithubActivity: fetchGithubActivityMock,
  githubGet: githubGetMock,
}));

import { BuildLogService, toHtml } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.service';
import { BuildLogRepository } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.repository';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';

// Canned structured replies per platform, keyed by the schema name writeDraft passes.
const REPLIES: Record<string, unknown> = {
  linkedin_draft: { content: 'Line one.\n\nLine <two> & more.' },
  x_draft: { posts: ['Shipped it.', 'Thread part two.'] },
  reddit_draft: { subreddit: 'r/webdev', title: 'How we fixed a login race', body: 'Context…' },
  instagram_draft: { caption: 'Timeline editor', slides: ['Before', 'After'] },
};
const fakeModel = {
  withStructuredOutput: vi.fn((_s: unknown, { name }: { name: string }) => ({
    invoke: vi.fn().mockResolvedValue(REPLIES[name]),
  })),
};

const integration = (id: string, providerIdentifier: string, disabled = false) =>
  ({ id, providerIdentifier, disabled, organizationId: 'org-1' }) as any;

describe('BuildLogService', () => {
  let repo: any, integrations: any, posts: any, ai: any, service: BuildLogService;

  beforeEach(() => {
    repo = new BuildLogRepository(null as any, null as any);
    integrations = new IntegrationService(...([] as unknown as [any]));
    posts = new PostsService(...([] as unknown as [any]));
    ai = new AIModelProvider(...([] as unknown as [any]));
    service = new BuildLogService(
      repo,
      new EncryptionService(),
      new BrandsService(null as any),
      integrations,
      posts,
      ai
    );
    ai.langchainModel.mockResolvedValue(fakeModel);
    repo.getActivitiesByIds.mockResolvedValue([
      { id: 'a1', kind: 'release', title: 'Release v1.3.0', body: 'Timeline editor', url: 'https://g/r/9', occurredAt: new Date('2026-10-21') },
    ]);
    integrations.getIntegrationsList.mockResolvedValue([
      integration('li', 'linkedin'),
      integration('lp', 'linkedin-page'),
      integration('x', 'x'),
      integration('rd', 'reddit'),
      integration('ig', 'instagram-standalone'),
      integration('yt', 'youtube'), // unsupported → ignored
      integration('off', 'x', true), // disabled → ignored
    ]);
    posts.findFreeDateTime.mockResolvedValue('2026-10-24T09:30:00');
  });

  it('creates one BUILD_LOG draft per selected supported channel, one LLM call per platform', async () => {
    const res = await service.generateDrafts(
      'org-1',
      { activityIds: ['a1'], integrationIds: ['li', 'lp', 'x', 'rd', 'ig', 'yt', 'off'] },
      'user-1'
    );

    expect(res).toEqual({ date: '2026-10-24T09:30:00', drafts: 5, platforms: ['linkedin', 'x', 'reddit', 'instagram'] });
    expect(ai.langchainModel).toHaveBeenCalledWith('generator', 'org-1');
    // Two LinkedIn channels share one draft → 4 calls, not 5.
    expect(fakeModel.withStructuredOutput).toHaveBeenCalledTimes(4);

    expect(posts.createPost).toHaveBeenCalledTimes(1);
    const [orgId, body, method, userId] = posts.createPost.mock.calls[0];
    expect([orgId, method, userId]).toEqual(['org-1', 'BUILD_LOG', 'user-1']);
    expect(body).toMatchObject({ type: 'draft', date: '2026-10-24T09:30:00Z', shortLink: false });

    const byId = Object.fromEntries(body.posts.map((p: any) => [p.integration.id, p]));
    expect(Object.keys(byId).sort()).toEqual(['ig', 'li', 'lp', 'rd', 'x']);
    expect(byId.li.value[0].content).toBe('<p>Line one.</p><p>Line &lt;two&gt; &amp; more.</p>');
    expect(byId.x.value.map((v: any) => v.content)).toEqual(['<p>Shipped it.</p>', '<p>Thread part two.</p>']);
    expect(byId.x.settings).toEqual({ __type: 'x', who_can_reply_post: 'everyone' });
    expect(byId.rd.settings.subreddit[0].value).toMatchObject({ subreddit: 'webdev', title: 'How we fixed a login race', type: 'self' });
    expect(byId.ig.settings).toEqual({ __type: 'instagram-standalone', post_type: 'post', collaborators: [] });
    expect(byId.lp.settings).toEqual({ __type: 'linkedin-page', post_as_images_carousel: false });

    expect(repo.markUsed).toHaveBeenCalledWith('org-1', ['a1']);
  });

  it('falls back to tomorrow 09:00 UTC when the org has no posting slots', async () => {
    posts.findFreeDateTime.mockRejectedValue(new Error('No posting times configured'));
    const res = await service.generateDrafts('org-1', { activityIds: ['a1'], integrationIds: ['x'] });
    expect(res.date).toMatch(/T09:00:00$/);
  });

  it('rejects when no supported channel or no activity is selected, before calling the LLM', async () => {
    await expect(service.generateDrafts('org-1', { activityIds: ['a1'], integrationIds: ['yt'] })).rejects.toThrow(/LinkedIn, X, Reddit or Instagram/);
    repo.getActivitiesByIds.mockResolvedValue([]);
    await expect(service.generateDrafts('org-1', { activityIds: ['zz'], integrationIds: ['x'] })).rejects.toThrow(/at least one activity/);
    expect(ai.langchainModel).not.toHaveBeenCalled();
  });

  it('returns 422 with the standard message when the org has no AI provider, creating nothing', async () => {
    ai.resolveConfigForScope.mockResolvedValue(null);
    await expect(
      service.generateDrafts('org-1', { activityIds: ['a1'], integrationIds: ['x'] })
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('AI is not configured') });
    expect(ai.langchainModel).not.toHaveBeenCalled();
    expect(posts.createPost).not.toHaveBeenCalled();
    expect(repo.markUsed).not.toHaveBeenCalled();
  });

  it('validates the repo on GitHub first, lowercases it, encrypts the token and never returns it', async () => {
    githubGetMock.mockResolvedValue({});
    repo.upsertSource.mockResolvedValue({ id: 's1', repo: 'acme/app', token: 'enc(tok)' });
    expect(await service.addSource('org-1', { repo: 'Acme/App', token: 'tok' })).toEqual({ id: 's1', repo: 'acme/app', hasToken: true });
    expect(githubGetMock).toHaveBeenCalledWith(expect.any(Function), 'acme/app', '', 'tok');
    expect(repo.upsertSource).toHaveBeenCalledWith('org-1', 'acme/app', 'enc(tok)');

    // Re-adding without a token passes undefined so the stored token is kept.
    await service.addSource('org-1', { repo: 'acme/app' });
    expect(repo.upsertSource).toHaveBeenLastCalledWith('org-1', 'acme/app', undefined);

    repo.getSources.mockResolvedValue([{ id: 's1', repo: 'acme/app', token: null }]);
    expect(await service.getSources('org-1')).toEqual([{ id: 's1', repo: 'acme/app', hasToken: false }]);
  });

  it('does not save a repo GitHub cannot find', async () => {
    githubGetMock.mockRejectedValue(new Error('acme/nmae was not found on GitHub.'));
    await expect(service.addSource('org-1', { repo: 'acme/nmae' })).rejects.toThrow(/not found/);
    expect(repo.upsertSource).not.toHaveBeenCalled();
  });

  it('sync decrypts tokens, keeps going past a failing repo and reports it', async () => {
    const last = new Date('2026-10-20T00:00:00Z');
    repo.getSources.mockResolvedValue([
      { id: 's0', repo: 'acme/gone', token: null, lastSyncedAt: last },
      { id: 's1', repo: 'acme/app', token: 'enc(tok)', lastSyncedAt: last },
    ]);
    fetchGithubActivityMock
      .mockRejectedValueOnce(new Error('acme/gone was not found on GitHub.'))
      .mockResolvedValueOnce([{ kind: 'commit', externalId: 'x' }]);
    repo.addActivities.mockResolvedValue({ count: 1 });

    expect(await service.sync('org-1')).toEqual({
      added: 1,
      errors: [{ repo: 'acme/gone', message: 'acme/gone was not found on GitHub.' }],
    });
    expect(fetchGithubActivityMock).toHaveBeenLastCalledWith(expect.any(Function), 'acme/app', last, 'tok');
    expect(repo.markSynced).toHaveBeenCalledTimes(1);
    expect(repo.markSynced).toHaveBeenCalledWith('org-1', 's1');
  });
});

describe('toHtml', () => {
  it('maps paragraphs and line breaks to the composer HTML', () => {
    expect(toHtml('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
  });
});
