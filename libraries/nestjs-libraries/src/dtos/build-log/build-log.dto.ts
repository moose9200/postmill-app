import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { REPO_PATTERN } from '@postmill-ai/nestjs-libraries/database/prisma/build-log/build-log.github';

// Validate the trimmed value so "   " cannot pass a MinLength check.
const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class BuildSourceDto {
  @trim()
  @IsString()
  @Matches(REPO_PATTERN, { message: 'Repo must look like owner/name' })
  repo: string;

  // GitHub personal access token; optional for public repos.
  @trim()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  token?: string;
}

export class BuildNoteDto {
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  text: string;
}

export class GenerateDraftsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  activityIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  integrationIds: string[];
}
