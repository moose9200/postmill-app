import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({ safeFetch: safeFetchMock }));

import { MediaStreamService } from './media-stream.service';

const fakeRes = () => {
  const res: any = new PassThrough();
  res.headers = {} as Record<string, string>;
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.status = vi.fn(() => res);
  res.type = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.resume();
  return res;
};

describe('MediaStreamService.streamExternalUrl', () => {
  it('never reflects the upstream content-type: an HTML upstream is served as inert video', async () => {
    safeFetchMock.mockResolvedValue(
      new Response('<script>alert(1)</script>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    const res = fakeRes();
    await new MediaStreamService().streamExternalUrl('https://evil.example/x?a=mp4', new PassThrough() as any, res);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });
});
