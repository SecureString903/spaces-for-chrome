// Small shared helpers.

// Normalize a user-typed URL: trim, and prepend https:// when no scheme is
// present. Returns '' for empty input.
export function normalizeUrl(input) {
  const url = (input || '').trim();
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
}
