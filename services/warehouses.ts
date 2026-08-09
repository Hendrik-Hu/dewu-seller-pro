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

const requireWarehouseResult = (data: unknown): Warehouse => {
  if (!data || typeof data !== 'object') throw new Error('仓库操作未返回有效结果');
  return mapWarehouseFromDb(data);
};

export const createWarehouse = async (name: string): Promise<Warehouse> => {
  const { data, error } = await supabase.rpc('create_warehouse', { p_name: name });
  if (error) throw error;
  return requireWarehouseResult(data);
};

export const renameWarehouse = async (id: string, name: string): Promise<Warehouse> => {
  const { data, error } = await supabase.rpc('rename_warehouse', {
    p_warehouse_id: id,
    p_name: name,
  });
  if (error) throw error;
  return requireWarehouseResult(data);
};

export const setDefaultWarehouse = async (id: string): Promise<Warehouse> => {
  const { data, error } = await supabase.rpc('set_default_warehouse', { p_warehouse_id: id });
  if (error) throw error;
  return requireWarehouseResult(data);
};

export const deleteWarehouse = async (id: string): Promise<void> => {
  const { error } = await supabase.rpc('delete_warehouse', { p_warehouse_id: id });
  if (error) throw error;
};
