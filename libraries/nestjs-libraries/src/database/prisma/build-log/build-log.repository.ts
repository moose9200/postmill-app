import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { ActivityInput } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.github';

@Injectable()
export class BuildLogRepository {
  constructor(
    private _source: PrismaRepository<'buildSource'>,
    private _activity: PrismaRepository<'buildActivity'>
  ) {}

  getSources(orgId: string) {
    return this._source.model.buildSource.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Re-adding a repo with a token replaces it; without one the stored token is kept.
  upsertSource(orgId: string, repo: string, token?: string) {
    return this._source.model.buildSource.upsert({
      where: { organizationId_repo: { organizationId: orgId, repo } },
      create: { organizationId: orgId, repo, token: token ?? null },
      update: token ? { token } : {},
    });
  }

  deleteSource(orgId: string, id: string) {
    return this._source.model.buildSource.deleteMany({
      where: { id, organizationId: orgId },
    });
  }

  markSynced(orgId: string, id: string) {
    return this._source.model.buildSource.update({
      where: { id, organizationId: orgId },
      data: { lastSyncedAt: new Date() },
    });
  }

  addActivities(orgId: string, items: ActivityInput[]) {
    return this._activity.model.buildActivity.createMany({
      data: items.map((i) => ({ ...i, organizationId: orgId })),
      skipDuplicates: true,
    });
  }

  getActivities(orgId: string) {
    return this._activity.model.buildActivity.findMany({
      where: { organizationId: orgId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  }

  getActivitiesByIds(orgId: string, ids: string[]) {
    return this._activity.model.buildActivity.findMany({
      where: { organizationId: orgId, id: { in: ids } },
      orderBy: { occurredAt: 'asc' },
    });
  }

  markUsed(orgId: string, ids: string[]) {
    return this._activity.model.buildActivity.updateMany({
      where: { organizationId: orgId, id: { in: ids } },
      data: { usedAt: new Date() },
    });
  }
}
