import { describe, it, expect, afterEach } from 'vitest';
import { getCookieUrlFromDomain } from './subdomain.management';

describe('getCookieUrlFromDomain', () => {
  afterEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  it('defaults to the registrable domain', () => {
    expect(getCookieUrlFromDomain('https://app.example.com')).toBe('.example.com');
  });

  it('uses COOKIE_DOMAIN when set, so a shared host never scopes cookies to railway.app', () => {
    expect(getCookieUrlFromDomain('https://x.up.railway.app')).toBe('.railway.app');
    process.env.COOKIE_DOMAIN = 'x.up.railway.app';
    expect(getCookieUrlFromDomain('https://x.up.railway.app')).toBe('x.up.railway.app');
  });
});
