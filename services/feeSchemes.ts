import { supabase } from '../lib/supabase';
import type { FeeScheme } from '../types';
import { validateFeeScheme } from '../lib/feeCalculations';

const mapFeeScheme = (row: any): FeeScheme => ({
  id: String(row.id),
  name: String(row.name || ''),
  saleMode: String(row.sale_mode || ''),
  category: String(row.category || ''),
  percentRate: Number(row.percent_rate || 0),
  percentMin: row.percent_min == null ? undefined : Number(row.percent_min),
  percentMax: row.percent_max == null ? undefined : Number(row.percent_max),
  percentageUnit: row.percentage_unit === 'item' ? 'item' : 'transaction',
  fixedFee: Number(row.fixed_fee || 0),
  fixedFeeUnit: row.fixed_fee_unit === 'item' ? 'item' : 'transaction',
  shippingFee: Number(row.shipping_fee || 0),
  shippingFeeUnit: row.shipping_fee_unit === 'item' ? 'item' : 'transaction',
  otherFee: Number(row.other_fee || 0),
  otherFeeUnit: row.other_fee_unit === 'item' ? 'item' : 'transaction',
  effectiveFrom: String(row.effective_from),
  isDefault: Boolean(row.is_default),
  updatedAt: String(row.updated_at),
});

const toFeeSchemeRow = (scheme: Omit<FeeScheme, 'id' | 'updatedAt'>, userId: string) => ({
  user_id: userId,
  name: scheme.name.trim(),
  sale_mode: scheme.saleMode.trim(),
  category: scheme.category.trim(),
  percent_rate: scheme.percentRate,
  percent_min: scheme.percentMin ?? null,
  percent_max: scheme.percentMax ?? null,
  percentage_unit: scheme.percentageUnit,
  fixed_fee: scheme.fixedFee,
  fixed_fee_unit: scheme.fixedFeeUnit,
  shipping_fee: scheme.shippingFee,
  shipping_fee_unit: scheme.shippingFeeUnit,
  other_fee: scheme.otherFee,
  other_fee_unit: scheme.otherFeeUnit,
  effective_from: scheme.effectiveFrom,
  is_default: scheme.isDefault,
});

export const listFeeSchemes = async (userId: string): Promise<FeeScheme[]> => {
  const { data, error } = await supabase.from('fee_schemes').select('*').eq('user_id', userId)
    .order('is_default', { ascending: false }).order('effective_from', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapFeeScheme);
};

export const saveFeeScheme = async (
  userId: string,
  scheme: Omit<FeeScheme, 'id' | 'updatedAt'>,
  id?: string,
): Promise<FeeScheme> => {
  validateFeeScheme(scheme);
  const row = toFeeSchemeRow(scheme, userId);
  const query = id
    ? supabase.from('fee_schemes').update(row).eq('id', id).eq('user_id', userId)
    : supabase.from('fee_schemes').insert(row);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return mapFeeScheme(data);
};

export const deleteFeeScheme = async (userId: string, id: string) => {
  const { error } = await supabase.from('fee_schemes').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
};
