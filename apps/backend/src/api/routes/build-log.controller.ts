import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ParseCuidPipe } from '@postmill-ai/nestjs-libraries/pipes/parse-cuid.pipe';
import { BudgetExceeded } from '@postmill-ai/nestjs-libraries/ai/governance/errors';
import { rethrowProviderError } from '@postmill-ai/nestjs-libraries/ai/governance/rethrow-provider-error';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { BuildLogService } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.service';
import {
  BuildNoteDto,
  BuildSourceDto,
  GenerateDraftsDto,
} from '@postmill-ai/nestjs-libraries/dtos/build-log/build-log.dto';

// Build Log shares the `autopost` RBAC resource (same feature class: automated content
// sources); generating drafts creates posts, so it carries the posts gates.
@ApiTags('Build Log')
@Controller('/build-log')
export class BuildLogController {
  constructor(private _buildLogService: BuildLogService) {}

  @Get('/sources')
  @RequirePermission('autopost', 'read')
  getSources(@GetOrgFromRequest() org: Organization) {
    return this._buildLogService.getSources(org.id);
  }

  @Post('/sources')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  @RequirePermission('autopost', 'create')
  addSource(@GetOrgFromRequest() org: Organization, @Body() body: BuildSourceDto) {
    return this._buildLogService.addSource(org.id, body);
  }

  @Delete('/sources/:id')
  @RequirePermission('autopost', 'delete')
  deleteSource(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string
  ) {
    return this._buildLogService.deleteSource(org.id, id);
  }

  // Each repo costs 4 GitHub calls; tokenless orgs share GitHub's 60/h per egress IP.
  @Post('/sync')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @RequirePermission('autopost', 'update')
  sync(@GetOrgFromRequest() org: Organization) {
    return this._buildLogService.sync(org.id);
  }

  @Get('/activities')
  @RequirePermission('autopost', 'read')
  getActivities(@GetOrgFromRequest() org: Organization) {
    return this._buildLogService.getActivities(org.id);
  }

  @Get('/channels')
  getSupportedChannels() {
    return this._buildLogService.getSupportedChannels();
  }

  @Post('/notes')
  @RequirePermission('autopost', 'create')
  addNote(@GetOrgFromRequest() org: Organization, @Body() body: BuildNoteDto) {
    return this._buildLogService.addNote(org.id, body);
  }

  @Post('/generate')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async generate(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: GenerateDraftsDto
  ) {
    try {
      return await this._buildLogService.generateDrafts(org.id, body, user?.id);
    } catch (err) {
      // The org's own AI provider said no → the global filter answers 502 naming it.
      rethrowProviderError(err);
      if (err instanceof BudgetExceeded) {
        throw new HttpException(
          { error: 'BudgetExceeded', message: err.message },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      throw err;
    }
  }
}
