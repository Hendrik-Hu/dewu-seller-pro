import { supabase } from '../lib/supabase';
import type { OutboundSettlementAudit } from '../types';

export interface SaveSettlementInput {
  userId: string;
  activityId: string;
  operationId: string;
  actualPlatformFee: number;
  settledAt: string;
  orderNo?: string;
  note?: string;
}

export const saveOutboundSettlement = async (input: SaveSettlementInput) => {
  const { data, error } = await supabase.rpc('settle_outbound_activity', {
    p_activity_id: input.activityId,
    p_actual_platform_fee: input.actualPlatformFee,
    p_note: input.note?.trim() || null,
    p_operation_id: input.operationId,
    p_order_no: input.orderNo?.trim() || null,
    p_settled_at: input.settledAt,
    p_user_id: input.userId,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
};

export const listOutboundSettlementAudit = async (userId: string, activityId: string): Promise<OutboundSettlementAudit[]> => {
  const { data, error } = await supabase.from('outbound_settlement_audit')
    .select('id,activity_id,revision,previous_snapshot,settlement_snapshot,created_at')
    .eq('user_id', userId).eq('activity_id', activityId).order('revision', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id, activityId: row.activity_id, revision: Number(row.revision),
    previousSnapshot: row.previous_snapshot || undefined,
    settlementSnapshot: row.settlement_snapshot || {}, createdAt: row.created_at,
  }));
};
