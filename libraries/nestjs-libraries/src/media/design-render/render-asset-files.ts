// Dependency-free (fs/path only) helpers for the pre-downloaded render assets
// (see render-assets.ts). Shared by the token-gated HTTP route
// (DesignRenderFrameController.renderAsset) and the capture page's request
// interceptor (ChromiumFrameCaptureService), which serves the same files
// straight from the local assets dir — so a render never depends on the
// load-balanced backend URL landing on the replica that downloaded them.
// Kept free of Redis/Nest imports because the Podman render worker (no Redis)
// loads it through the capture service.

import * as fs from 'fs';
import * as path from 'path';

export const RENDER_ASSETS_DIR = 'assets';
export const RENDER_ASSET_MANIFEST = 'manifest.json';

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

export function mimeByExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

// Only the names preloadRenderMedia writes (asset-<i>.<ext>).
const SAFE_ASSET_FILE_NAME = /^asset-(\d+)\.([a-z0-9]{1,16})$/;

/**
 * Validate a render-asset file name and REBUILD it from the strict regex
 * captures, so the string used in path construction is provably free of path
 * separators and parent refs (CodeQL js/path-injection needs the sanitization
 * to dominate the path expression). Null for anything else — the manifest,
 * traversal attempts, dotfiles.
 */
export function safeRenderAssetFileName(fileName: string): string | null {
  const match = SAFE_ASSET_FILE_NAME.exec(fileName);
  if (!match) return null;
  return `asset-${match[1]}.${match[2]}`;
}

/** Render job ids are Prisma cuids; the route param feeds a filesystem path, so pin the alphabet. */
export function isSafeRenderAssetJobId(jobId: string): boolean {
  return /^[a-z0-9]{20,40}$/i.test(jobId);
}

export interface LocalRenderAsset {
  filePath: string;
  contentType: string;
  size: number;
}

/**
 * Stat a pre-downloaded asset inside `assetsDir`. `fileName` must already be
 * the output of safeRenderAssetFileName. Null when the file is absent. The
 * content type comes from the preloader's manifest, falling back to the
 * extension.
 */
export function statLocalRenderAsset(
  assetsDir: string,
  safeName: string,
): LocalRenderAsset | null {
  const root = path.resolve(assetsDir);
  const filePath = path.resolve(root, safeName);
  // Belt and braces: the rebuilt name cannot escape, but verify containment.
  if (!filePath.startsWith(root + path.sep)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  let contentType = '';
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, RENDER_ASSET_MANIFEST), 'utf8'),
    );
    if (typeof manifest?.[safeName] === 'string') {
      contentType = manifest[safeName];
    }
  } catch {
    /* fall back to the extension guess */
  }
  if (!contentType) contentType = mimeByExt(safeName);
  return { filePath, contentType, size: stat.size };
}

export type ByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Parse a `Range` header against a file of `size` bytes. Single
 * `bytes=start-[end]` ranges only (what Chromium's media stack sends while
 * seeking a <video>); anything else — absent, multi-range, suffix — is served
 * as the full body, matching the original route behaviour. `end` is clamped
 * to the last byte; a start past EOF or an inverted range is unsatisfiable
 * (416 + `Content-Range: bytes * /size`).
 */
export function parseByteRange(range: string | undefined, size: number): ByteRange {
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return { kind: 'full' };
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}

// `/media/designs/render-asset/:jobId/:file` at the END of the path, so a
// backend mounted under a prefix (`https://host/api/...`) still matches.
const RENDER_ASSET_URL_PATH = /\/media\/designs\/render-asset\/([^/]+)\/([^/]+)$/;

/** Extract the raw (decoded) jobId/file of a render-asset URL; null for any other URL. */
export function parseRenderAssetUrl(url: string): { jobId: string; fileName: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = RENDER_ASSET_URL_PATH.exec(pathname);
  if (!match) return null;
  try {
    return { jobId: decodeURIComponent(match[1]), fileName: decodeURIComponent(match[2]) };
  } catch {
    return { jobId: '', fileName: '' };
  }
}
