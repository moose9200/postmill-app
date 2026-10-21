import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseByteRange,
  parseRenderAssetUrl,
  statLocalRenderAsset,
} from './render-asset-files';

describe('parseByteRange', () => {
  it('serves the full body when there is no Range header', () => {
    expect(parseByteRange(undefined, 100)).toEqual({ kind: 'full' });
  });

  it('parses a closed single range', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ kind: 'partial', start: 10, end: 19 });
  });

  it('parses an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
  });

  it('clamps an end past EOF to the last byte', () => {
    expect(parseByteRange('bytes=0-1000', 100)).toEqual({ kind: 'partial', start: 0, end: 99 });
  });

  it('marks a start past EOF or an inverted range unsatisfiable (416)', () => {
    expect(parseByteRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=50-10', 100)).toEqual({ kind: 'unsatisfiable' });
  });

  it('falls back to the full body for multi-range / suffix / malformed headers', () => {
    expect(parseByteRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ kind: 'full' });
    expect(parseByteRange('items=0-1', 100)).toEqual({ kind: 'full' });
  });
});

describe('parseRenderAssetUrl', () => {
  it('extracts jobId and file from a render-asset URL (with or without a path prefix)', () => {
    expect(
      parseRenderAssetUrl('https://api.example.com/media/designs/render-asset/cjob123/asset-0.mp4?token=t'),
    ).toEqual({ jobId: 'cjob123', fileName: 'asset-0.mp4' });
    expect(
      parseRenderAssetUrl('https://example.com/api/media/designs/render-asset/cjob123/asset-1.png'),
    ).toEqual({ jobId: 'cjob123', fileName: 'asset-1.png' });
  });

  it('decodes percent-encoded segments so the validators see the real value', () => {
    expect(
      parseRenderAssetUrl('https://x.test/media/designs/render-asset/cjob/..%2Fsecret'),
    ).toEqual({ jobId: 'cjob', fileName: '../secret' });
  });

  it('returns null for any other URL', () => {
    expect(parseRenderAssetUrl('https://x.test/media/designs/render-frame/cjob?token=t')).toBeNull();
    expect(parseRenderAssetUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(parseRenderAssetUrl('not a url')).toBeNull();
  });
});

describe('statLocalRenderAsset', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-asset-files-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stats an asset with the manifest content-type, falling back to the extension', () => {
    fs.writeFileSync(path.join(dir, 'asset-0.bin'), Buffer.alloc(7));
    fs.writeFileSync(path.join(dir, 'asset-1.webm'), Buffer.alloc(3));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ 'asset-0.bin': 'video/mp4' }));
    expect(statLocalRenderAsset(dir, 'asset-0.bin')).toEqual({
      filePath: path.resolve(dir, 'asset-0.bin'),
      contentType: 'video/mp4',
      size: 7,
    });
    expect(statLocalRenderAsset(dir, 'asset-1.webm')?.contentType).toBe('video/webm');
  });

  it('returns null for a missing file', () => {
    expect(statLocalRenderAsset(dir, 'asset-9.mp4')).toBeNull();
  });
});
