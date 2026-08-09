const extractApiKey = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["api_key", "apiKey", "key", "value"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  return undefined;
};

export const readHostedApiKey = (
  serializedKeys: string | undefined,
): string | undefined => {
  if (serializedKeys) {
    try {
      const parsed = JSON.parse(serializedKeys) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? Object.values(parsed as Record<string, unknown>)
          : [];

      for (const entry of entries) {
        const key = extractApiKey(entry);
        if (key) return key;
      }
    } catch {}
  }

  return undefined;
};
