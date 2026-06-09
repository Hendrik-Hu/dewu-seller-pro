import { supabase } from '../lib/supabase';
import { Warehouse } from '../types';
import { mapWarehouseFromDb } from './mappers';

export const listWarehouses = async (userId: string): Promise<Warehouse[]> => {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, name, is_default')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapWarehouseFromDb);
};

export const createDefaultWarehouses = async (userId: string): Promise<Warehouse[]> => {
  const defaults = ['鏉窞涓€鍙蜂粨', '涓婃捣娴︿笢浠?', '鍖椾含澶у叴浠?', '骞垮窞鐧戒簯浠?'];

  const { data, error } = await supabase
    .from('warehouses')
    .insert(defaults.map((name, index) => ({
      name,
      user_id: userId,
      created_at: new Date().toISOString(),
      is_default: index === 0,
    })))
    .select('id, name, is_default');

  if (error) throw error;
  return (data || []).map(mapWarehouseFromDb);
};

export const renameWarehouse = async (userId: string, id: string, name: string) => {
  const { error } = await supabase
    .from('warehouses')
    .update({ name })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
};

export const setDefaultWarehouse = async (userId: string, id: string) => {
  const { error: resetError } = await supabase
    .from('warehouses')
    .update({ is_default: false })
    .eq('user_id', userId);

  if (resetError) throw resetError;

  const { error } = await supabase
    .from('warehouses')
    .update({ is_default: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
};
