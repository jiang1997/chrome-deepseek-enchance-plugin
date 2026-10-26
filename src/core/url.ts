/** Recognize a single selected web address without treating prose as a URL. */
export function selectedWebUrl(text: string): string | null {
  const value = text.trim();
  if (!/^(https?:\/\/|www\.)/i.test(value) || /[\s<>"\\]/u.test(value)) return null;
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    if (!url.hostname || url.username || url.password) return null;
    if (/^www\./i.test(value) && !/^www\..+\..+$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
