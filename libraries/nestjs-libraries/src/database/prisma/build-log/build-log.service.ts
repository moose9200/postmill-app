import {
  BadRequestException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { BuildActivity, Integration } from '@prisma/client';
import { BuildLogRepository } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.repository';
import {
  fetchGithubActivity,
  githubGet,
} from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.github';
import {
  Draft,
  Platform,
  PLATFORM_OF,
  writeDraft,
} from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.agent';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { BrandsService } from '@postmill-ai/nestjs-libraries/brands/brands.service';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { makeId } from '@postmill-ai/nestjs-libraries/services/make.is';
import {
  BuildNoteDto,
  BuildSourceDto,
  GenerateDraftsDto,
} from '@postmill-ai/nestjs-libraries/dtos/build-log/build-log.dto';

dayjs.extend(utc);

// First sync looks back this far; later syncs start at lastSyncedAt.
const FIRST_SYNC_DAYS = 30;
// Keeps the prompt bounded when many activities are selected.
const PROMPT_ACTIVITY_MAX = 1500;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The composer stores HTML: blank-line paragraphs → <p>, single newlines → <br>.
export const toHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');

// Activity text must not be able to close (or reopen) the <build_activity> fence.
const unfence = (s: string) => s.replace(/<\s*\/?\s*build_activity/gi, '[build activity]');

// Each source costs 4 GitHub calls per sync; keep one sync request bounded.
export const MAX_BUILD_SOURCES = 20;

export const formatActivities = (activities: BuildActivity[]) =>
  activities
    .map((a) =>
      [
        `- [${a.kind}] ${unfence(a.title)} (${dayjs(a.occurredAt).format('YYYY-MM-DD')})`,
        a.body ? `  ${unfence(a.body.slice(0, PROMPT_ACTIVITY_MAX)).replace(/\n/g, '\n  ')}` : '',
        a.url ? `  ${a.url}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');

export const settingsFor = (integration: Integration, draft: Draft) => {
  const __type = integration.providerIdentifier;
  switch (PLATFORM_OF[__type]) {
    case 'reddit':
      return {
        __type,
        subreddit: [
          {
            value: {
              subreddit: draft.subreddit,
              title: draft.title,
              type: 'self',
              url: '',
              is_flair_required: false,
            },
          },
        ],
      };
    case 'x':
      return { __type, who_can_reply_post: 'everyone' };
    case 'instagram':
      return { __type, post_type: 'post', collaborators: [] as { label: string }[] };
    default:
      return { __type, post_as_images_carousel: false };
  }
};

@Injectable()
export class BuildLogService {
  constructor(
    private _buildLogRepository: BuildLogRepository,
    private _encryptionService: EncryptionService,
    private _brandsService: BrandsService,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    @Inject(forwardRef(() => PostsService))
    private _postsService: PostsService,
    @Inject(forwardRef(() => AIModelProvider))
    private _aiModelProvider: AIModelProvider
  ) {}

  async getSources(orgId: string) {
    const sources = await this._buildLogRepository.getSources(orgId);
    // Never return the token, only whether one is stored.
    return sources.map(({ token, ...s }) => ({ ...s, hasToken: !!token }));
  }

  async addSource(orgId: string, body: BuildSourceDto) {
    // GitHub names are case-insensitive; one casing keeps sources and dedupe ids unique.
    const repo = body.repo.toLowerCase();
    const existing = await this._buildLogRepository.getSources(orgId);
    if (existing.length >= MAX_BUILD_SOURCES && !existing.some((s) => s.repo === repo)) {
      throw new BadRequestException(`You can track up to ${MAX_BUILD_SOURCES} repos.`);
    }
    // Reject typos and unreachable private repos now, not on every later sync.
    await githubGet(safeFetch, repo, '', body.token);
    const { token, ...source } = await this._buildLogRepository.upsertSource(
      orgId,
      repo,
      body.token ? this._encryptionService.encrypt(body.token) : undefined
    );
    return { ...source, hasToken: !!token };
  }

  deleteSource(orgId: string, id: string) {
    return this._buildLogRepository.deleteSource(orgId, id);
  }

  getActivities(orgId: string) {
    return this._buildLogRepository.getActivities(orgId);
  }

  // Channel identifiers that have a playbook; the UI offers only these.
  getSupportedChannels() {
    return Object.keys(PLATFORM_OF);
  }

  addNote(orgId: string, body: BuildNoteDto) {
    const text = body.text.trim();
    return this._buildLogRepository.addActivities(orgId, [
      {
        kind: 'note',
        externalId: `note:${randomUUID()}`,
        title: text.split('\n')[0].slice(0, 120),
        body: text,
        occurredAt: new Date(),
      },
    ]);
  }

  // One failing repo never blocks the others; its error is reported, not thrown.
  async sync(orgId: string) {
    let added = 0;
    const errors: { repo: string; message: string }[] = [];
    for (const source of await this._buildLogRepository.getSources(orgId)) {
      try {
        const items = await fetchGithubActivity(
          safeFetch,
          source.repo,
          source.lastSyncedAt ||
            dayjs().subtract(FIRST_SYNC_DAYS, 'day').toDate(),
          source.token ? this._encryptionService.decrypt(source.token) : undefined
        );
        added += (await this._buildLogRepository.addActivities(orgId, items)).count;
        await this._buildLogRepository.markSynced(orgId, source.id);
      } catch (err) {
        errors.push({ repo: source.repo, message: (err as Error).message });
      }
    }
    return { added, errors };
  }

  async generateDrafts(orgId: string, body: GenerateDraftsDto, userId?: string) {
    const activities = await this._buildLogRepository.getActivitiesByIds(
      orgId,
      body.activityIds
    );
    if (!activities.length) {
      throw new BadRequestException('Select at least one activity');
    }

    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter(
      (i) =>
        body.integrationIds.includes(i.id) &&
        !i.disabled &&
        PLATFORM_OF[i.providerIdentifier]
    );
    if (!integrations.length) {
      throw new BadRequestException(
        'Select at least one active LinkedIn, X, Reddit or Instagram channel'
      );
    }

    // No active org AI provider ⟹ AI is off; surface the standard message, not a 500.
    if (!(await this._aiModelProvider.resolveConfigForScope('generator', orgId))) {
      throw new HttpException(
        'AI is not configured for this organization. Go to Settings → AI to configure a provider.',
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    const model = await this._aiModelProvider.langchainModel('generator', orgId);
    const voice = (await this._brandsService.getDefaultBrand(orgId))?.instructions;
    const text = formatActivities(activities);

    // One draft per platform, shared by every channel of that platform.
    const platforms = [
      ...new Set(integrations.map((i) => PLATFORM_OF[i.providerIdentifier])),
    ];
    const drafts = Object.fromEntries(
      await Promise.all(
        platforms.map(async (p) => [p, await writeDraft(model, p, text, voice)])
      )
    ) as Record<Platform, Draft>;

    // Drafts need a date: the next free posting slot, else tomorrow 09:00 UTC.
    const date = await this._postsService
      .findFreeDateTime(orgId)
      .catch(() =>
        dayjs.utc().add(1, 'day').hour(9).minute(0).format('YYYY-MM-DDTHH:mm:00')
      );

    await this._postsService.createPost(
      orgId,
      {
        date: date + 'Z',
        order: makeId(10),
        shortLink: false,
        type: 'draft',
        tags: [],
        posts: integrations.map((i) => {
          const draft = drafts[PLATFORM_OF[i.providerIdentifier]];
          return {
            settings: settingsFor(i, draft) as any,
            group: makeId(10),
            integration: { id: i.id },
            value: draft.posts.map((content) => ({
              id: makeId(10),
              delay: 0,
              content: toHtml(content),
              image: [],
            })),
          };
        }),
      },
      'BUILD_LOG',
      userId
    );

    await this._buildLogRepository.markUsed(
      orgId,
      activities.map((a) => a.id)
    );

    return { date, drafts: integrations.length, platforms };
  }
}
