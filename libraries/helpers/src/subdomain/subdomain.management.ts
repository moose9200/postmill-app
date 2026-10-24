import { parse } from 'tldts';

// COOKIE_DOMAIN pins the cookie scope. Needed on shared hosts such as *.up.railway.app,
// where the registrable domain (railway.app) would share auth cookies with other tenants.
export function getCookieUrlFromDomain(domain: string) {
  if (process.env.COOKIE_DOMAIN) {
    return process.env.COOKIE_DOMAIN;
  }
  const url = parse(domain);
  return url.domain! ? '.' + url.domain! : url.hostname!;
}
