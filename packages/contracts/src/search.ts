export function isSearchFaviconHost(host: string): boolean {
  return host.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)
    && !/\.(?:arpa|example|internal|invalid|lan|local|localdomain|localhost|onion|test|ts\.net)$/.test(host)
}
