export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
  count: number | null;
}

interface FetchAllOptions<T> {
  pageSize?: number;
  getKey?: (row: T) => string;
  label?: string;
}

export const fetchAllPages = async <T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = 500, getKey, label = '数据' }: FetchAllOptions<T> = {},
): Promise<T[]> => {
  const rows: T[] = [];
  let expectedCount: number | null = null;

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) throw page.error;
    if (expectedCount === null) expectedCount = page.count;
    if (page.count !== null && expectedCount !== null && page.count !== expectedCount) {
      throw new Error(`${label}在读取期间发生变化，请重新读取`);
    }
    const pageRows = page.data || [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  if (expectedCount !== null && rows.length !== expectedCount) {
    throw new Error(`${label}数据读取不完整：应有 ${expectedCount} 条，实际读取 ${rows.length} 条`);
  }
  if (getKey) {
    const keys = rows.map(getKey);
    if (new Set(keys).size !== keys.length) throw new Error(`${label}分页出现重复记录，请重新读取`);
  }
  return rows;
};
