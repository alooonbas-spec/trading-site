export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) {
      continue;
    }
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

export function parseKeywordList(value: string): string[] {
  return normalizeKeywords(value.split(/[\n,]/));
}

export function matchKeywords(text: string, keywords: string[]): string[] {
  const haystack = text.toLowerCase();
  return normalizeKeywords(keywords).filter((keyword) => haystack.includes(keyword.toLowerCase()));
}
