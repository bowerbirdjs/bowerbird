/**
 * Allows http(s), mailto, tel and relative URLs (plus raster/SVG data URIs for images). Anything
 * else, such as `javascript:`, is replaced with "#" (links) or "" (images). Shared by the renderer,
 * lint and importers so they always agree.
 */
export function sanitizeUrl(url: string, kind: 'href' | 'src' = 'href'): string {
  const trimmed = url.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers ignore these inside schemes
  const probe = trimmed.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (/^(https?:|mailto:|tel:)/i.test(probe)) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(probe)) return trimmed;
  if (kind === 'src' && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(probe))
    return trimmed;
  return kind === 'src' ? '' : '#';
}

/** True if the renderer would replace this URL. */
export function isUnsafeUrl(url: string, kind: 'href' | 'src' = 'href'): boolean {
  return url.trim() !== '' && sanitizeUrl(url, kind) !== url.trim();
}
