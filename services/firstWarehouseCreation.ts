import { Preferences } from '@capacitor/preferences';

export interface PendingFirstWarehouseCreation {
  userId: string;
  name: string;
  requestedAt: string;
}

const getKey = (userId: string) => `firstWarehouseCreationPending:${userId}`;

export const savePendingFirstWarehouseCreation = async (userId: string, name: string) => {
  const pending: PendingFirstWarehouseCreation = {
    userId,
    name: name.trim(),
    requestedAt: new Date().toISOString(),
  };
  await Preferences.set({ key: getKey(userId), value: JSON.stringify(pending) });
};

export const loadPendingFirstWarehouseCreation = async (userId: string): Promise<PendingFirstWarehouseCreation | null> => {
  const { value } = await Preferences.get({ key: getKey(userId) });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingFirstWarehouseCreation>;
    if (parsed.userId !== userId || typeof parsed.name !== 'string' || !parsed.name.trim() || typeof parsed.requestedAt !== 'string') {
      await Preferences.remove({ key: getKey(userId) });
      return null;
    }
    return { userId, name: parsed.name.trim(), requestedAt: parsed.requestedAt };
  } catch {
    await Preferences.remove({ key: getKey(userId) });
    return null;
  }
};

export const clearPendingFirstWarehouseCreation = async (userId: string) => {
  await Preferences.remove({ key: getKey(userId) });
};
