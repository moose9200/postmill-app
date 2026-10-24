import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';

const pump = promisify(pipeline);

/**
 * Proxies an external media URL through to the HTTP response.
 *
 * Used by the public `/stream` endpoint so clients can request video assets
 * without exposing their origin credentials. The URL is fetched through
 * `safeFetch` (SSRF-guarded) and streamed back with the upstream headers
 * preserved, including range-request (206) support.
 */
@Injectable()
export class MediaStreamService {
  private readonly _logger = new Logger(MediaStreamService.name);

  async streamExternalUrl(
    url: string,
    req: Request,
    res: Response
  ): Promise<Response | void> {
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('aborted', onClose);
    res.on('close', onClose);

    let r: globalThis.Response | undefined;
    try {
      r = await safeFetch(url, { signal: ac.signal });
    } catch (err: any) {
      if (err?.message === 'Blocked URL') {
        return res.status(400).type('text/plain').send('Blocked URL');
      }
      if (err?.message === 'Too many redirects') {
        return res.status(508).type('text/plain').send('Too many redirects');
      }
      this._logger.warn(
        `Public stream upstream error: ${err?.message || 'unknown'}`
      );
      return res.status(502).type('text/plain').send('Upstream error');
    }

    if (!r.ok && r.status !== 206) {
      this._logger.warn(
        `Public stream upstream status ${r.status}: ${r.statusText}`
      );
      return res.status(r.status).type('text/plain').send('Upstream error');
    }

    // Unauthenticated proxy of an arbitrary URL: never reflect the upstream type, or an
    // HTML response would run on this origin. Serve it inert as video.
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const contentRange = r.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const acceptRanges = r.headers.get('accept-ranges') ?? 'bytes';
    res.setHeader('Accept-Ranges', acceptRanges);

    if (r.status === 206) res.status(206); // Partial Content for range responses

    try {
      await pump(Readable.fromWeb(r.body as any), res);
    } catch {
      // Response already closed or client disconnected; nothing to do.
    }
  }
}
