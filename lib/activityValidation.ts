export const normalizeActivityCountForWrite = (count: number | null | undefined) =>
  count === undefined || count === null ? 1 : Number(count);
