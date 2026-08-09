import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, X } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import type { Product, Warehouse } from '../types';
import { formatProductSize } from '../lib/productNormalization';
import { transferProduct } from '../services/transfers';

interface TransferProductModalProps {
  isOpen: boolean;
  product: Product | null;
  warehouses: Warehouse[];
  userId: string;
  onClose: () => void;
  onTransferred: () => void;
}

const createOperationId = () => globalThis.crypto?.randomUUID?.() || `transfer-${Date.now()}`;
const getTransferDraftKey = (userId: string, productId: string) => `transferDraftV1:${userId}:${productId}`;

export const TransferProductModal: React.FC<TransferProductModalProps> = ({
  isOpen,
  product,
  warehouses,
  userId,
  onClose,
  onTransferred,
}) => {
  const availableWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.name !== product?.warehouse),
    [product?.warehouse, warehouses],
  );
  const [targetWarehouse, setTargetWarehouse] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [operationId, setOperationId] = useState<string>(createOperationId);
  const [operationProductId, setOperationProductId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!product) {
      setOperationProductId(null);
      setIsDraftReady(false);
      return;
    }
    if (operationProductId === product.id) return;

    let mounted = true;
    const loadDraft = async () => {
      const fallbackWarehouse = warehouses.find((warehouse) => warehouse.name !== product.warehouse)?.name || '';
      try {
        const { value } = await Preferences.get({ key: getTransferDraftKey(userId, product.id) });
        if (!mounted) return;
        const draft = value ? JSON.parse(value) : null;
        const savedWarehouse = warehouses.some((warehouse) => warehouse.name === draft?.targetWarehouse && warehouse.name !== product.warehouse)
          ? draft.targetWarehouse
          : fallbackWarehouse;
        setOperationId(String(draft?.operationId || createOperationId()));
        setTargetWarehouse(savedWarehouse);
        setTargetLocation(String(draft?.targetLocation || ''));
        setQuantity(Number.isInteger(Number(draft?.quantity)) ? Number(draft.quantity) : 1);
        setSubmitted(Boolean(draft?.submitted));
      } catch (error) {
        console.warn('Failed to load transfer draft', error);
        setOperationId(createOperationId());
        setTargetWarehouse(fallbackWarehouse);
        setTargetLocation('');
        setQuantity(1);
        setSubmitted(false);
      } finally {
        if (mounted) {
          setOperationProductId(product.id);
          setIsDraftReady(true);
        }
      }
    };
    loadDraft();
    return () => { mounted = false; };
  }, [operationProductId, product, userId, warehouses]);

  useEffect(() => {
    if (!product || !isDraftReady || operationProductId !== product.id) return;
    Preferences.set({
      key: getTransferDraftKey(userId, product.id),
      value: JSON.stringify({ operationId, targetWarehouse, targetLocation, quantity, submitted }),
    }).catch((error) => console.warn('Failed to save transfer draft', error));
  }, [isDraftReady, operationId, operationProductId, product, quantity, submitted, targetLocation, targetWarehouse, userId]);

  if (!isOpen || !product) return null;

  const handleTransfer = async () => {
    if (!targetWarehouse) {
      alert('请选择目标仓库');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || (!submitted && quantity > product.stock)) {
      alert(`调拨数量必须是 1 到 ${product.stock} 之间的整数`);
      return;
    }

    setIsSubmitting(true);
    try {
      setSubmitted(true);
      await Preferences.set({
        key: getTransferDraftKey(userId, product.id),
        value: JSON.stringify({ operationId, targetWarehouse, targetLocation, quantity, submitted: true }),
      });
      await transferProduct({
        productId: product.id,
        userId,
        targetWarehouse,
        quantity,
        targetLocation,
        operationId,
      });
      await Preferences.remove({ key: getTransferDraftKey(userId, product.id) });
      onTransferred();
    } catch (error: any) {
      console.error('Transfer failed', error);
      const message = String(error?.message || '网络异常');
      const isValidationError = /insufficient|must differ|does not belong|not found|only instock|positive integer|required/i.test(message);
      if (isValidationError) {
        setSubmitted(false);
        await Preferences.set({
          key: getTransferDraftKey(userId, product.id),
          value: JSON.stringify({ operationId, targetWarehouse, targetLocation, quantity, submitted: false }),
        }).catch(() => {});
      }
      alert(isValidationError
        ? `调拨失败：${message}`
        : `调拨结果暂时无法确认：${message}。请保留当前内容后重试，同一操作不会重复扣减库存。`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <section className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">库存调拨</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">移动仓库归属，不改变总库存和成本</p>
          </div>
          <button onClick={onClose} disabled={isSubmitting} className="p-2 text-slate-400 disabled:opacity-40"><X size={20} /></button>
        </header>

        <div className="space-y-4 p-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-zinc-800">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-zinc-100">{product.name}</p>
            <p className="mt-1 text-xs text-slate-400">{product.sku} · {formatProductSize(product.size)} · 可调 {product.stock} 件</p>
          </div>

          <div className="grid grid-cols-[1fr_28px_1fr] items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">来源仓库</label>
              <div className="truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{product.warehouse}</div>
            </div>
            <ArrowRightLeft className="mb-2 text-dewu-500" size={18} />
            <div>
              <label className="mb-1 block text-xs text-slate-500">目标仓库</label>
              <select
                value={targetWarehouse}
                onChange={(event) => setTargetWarehouse(event.target.value)}
                disabled={submitted}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              >
                {availableWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.name}>{warehouse.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">调拨数量</label>
              <input
                type="number"
                min={1}
                max={product.stock}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                disabled={submitted}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">目标库位 <span className="text-slate-400">选填</span></label>
              <input
                type="text"
                value={targetLocation}
                onChange={(event) => setTargetLocation(event.target.value)}
                disabled={submitted}
                placeholder="例如 A-01"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
            </div>
          </div>

          <button
            onClick={handleTransfer}
            disabled={!isDraftReady || isSubmitting || availableWarehouses.length === 0 || (!submitted && (product.stock <= 0 || product.status !== 'instock'))}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-dewu-600"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={17} /> : <ArrowRightLeft size={17} />}
            {isSubmitting ? '正在调拨...' : submitted ? '核对上次调拨' : '确认调拨'}
          </button>
          {availableWarehouses.length === 0 && <p className="text-center text-xs text-amber-600">请先新增另一个仓库后再调拨</p>}
          {product.status !== 'instock' && !submitted && <p className="text-center text-xs text-amber-600">仅“在售”库存可以调拨</p>}
        </div>
      </section>
    </div>
  );
};
