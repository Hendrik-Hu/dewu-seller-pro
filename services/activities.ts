import { supabase } from '../lib/supabase';
import { Activity } from '../types';
import { mapActivityFromDb } from './mappers';
import { resolveStorageImageUrl } from './storageImages';
import { fetchAllPages } from './pagination';

export interface ActivityPageParams {
  userId: string;
  search?: string;
  type?: Activity['type'] | 'all';
  settlement?: 'all' | 'pending' | 'settled';
  warehouse?: string;
  period?: 'all' | 'month' | '30days';
  page?: number;
  pageSize?: number;
}

export interface ActivityPage {
  activities: Activity[];
  totalCount: number;
}

const escapeOrValue = (value: string) => value.replace(/[%(),]/g, '\\$&');

export const listActivityPage = async ({
  userId,
  search,
  type = 'all',
  settlement = 'all',
  warehouse = 'all',
  period = 'all',
  page = 1,
  pageSize = 30,
}: ActivityPageParams): Promise<ActivityPage> => {
  let query = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);

  if (type !== 'all') query = query.eq('type', type);
  if (settlement !== 'all') {
    query = query.eq('type', 'outbound');
    query = settlement === 'settled'
      ? query.gt('settlement_revision', 0)
      : query.or('settlement_revision.is.null,settlement_revision.eq.0');
  }
  if (warehouse !== 'all') query = query.eq('warehouse', warehouse);
  if (search?.trim()) {
    const value = escapeOrValue(search.trim());
    query = query.or(`product_name.ilike.%${value}%,sku.ilike.%${value}%`);
  }

  if (period === 'month') {
    const now = new Date();
    query = query.gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  } else if (period === '30days') {
    query = query.gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;

  const activities = await Promise.all((data || []).map(async (row) => {
    const activity = mapActivityFromDb(row);
    return { ...activity, imageUrl: await resolveStorageImageUrl(activity.imageStorageRef || activity.imageUrl) };
  }));
  return { activities, totalCount: count || 0 };
};
export const listActivities = async (userId: string): Promise<Activity[]> => {
  const rows = await fetchAllPages((from, to) => supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to), { getKey: (row: any) => String(row.id), label: '库存流水' });
  return Promise.all(rows.map(async (row) => {
    const activity = mapActivityFromDb(row);
    return { ...activity, imageUrl: await resolveStorageImageUrl(activity.imageStorageRef || activity.imageUrl) };
  }));
};

export const listRecentActivities = async (userId: string, limit = 10): Promise<Activity[]> => {
  const result = await listActivityPage({ userId, page: 1, pageSize: Math.min(Math.max(limit, 1), 50) });
  return result.activities;
};
