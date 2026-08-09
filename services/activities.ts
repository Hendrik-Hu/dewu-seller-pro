import { supabase } from '../lib/supabase';
import { Activity } from '../types';
import { mapActivityFromDb, mapActivityToDb } from './mappers';
import { resolveStorageImageUrl } from './storageImages';

export const listActivities = async (userId: string): Promise<Activity[]> => {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Promise.all((data || []).map(async (row) => {
    const activity = mapActivityFromDb(row);
    return { ...activity, imageUrl: await resolveStorageImageUrl(activity.imageStorageRef || activity.imageUrl) };
  }));
};

export const insertActivity = async (activity: Activity, userId: string) => {
  const { error } = await supabase
    .from('activities')
    .insert(mapActivityToDb(activity, userId));

  if (error) throw error;
};

interface CreateInventoryActivityParams {
  userId: string;
  type: Activity['type'];
  productName: string;
  sku: string;
  size?: string;
  price: number;
  cost?: number;
  imageUrl: string;
  warehouse?: string;
  count?: number;
  createdAt?: string;
}

export const createInventoryActivity = async ({
  userId,
  type,
  productName,
  sku,
  size,
  price,
  cost,
  imageUrl,
  warehouse,
  count = 1,
  createdAt,
}: CreateInventoryActivityParams) => {
  const timestamp = createdAt || new Date().toISOString();

  await insertActivity({
    id: `act-${Date.now()}`,
    type,
    productName,
    time: '刚刚',
    sku,
    size,
    price,
    cost,
    imageUrl,
    createdAt: timestamp,
    created_at: timestamp,
    warehouse,
    count,
  }, userId);
};

export const renameActivitiesWarehouse = async (userId: string, oldName: string, newName: string) => {
  const { error } = await supabase
    .from('activities')
    .update({ warehouse: newName })
    .eq('warehouse', oldName)
    .eq('user_id', userId);

  if (error) throw error;
};
