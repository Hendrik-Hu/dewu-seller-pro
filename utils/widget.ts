import { Preferences } from '@capacitor/preferences';

export interface WidgetData {
  totalStock: number;
  inboundToday: number;
  lastUpdated: string;
}

const WIDGET_STORAGE_KEY = 'widget_data';

export const updateWidgetData = async (data: WidgetData) => {
  try {
    // Store as a JSON string
    await Preferences.set({
      key: WIDGET_STORAGE_KEY,
      value: JSON.stringify(data),
    });
    console.log('Widget data updated:', data);
  } catch (error) {
    console.error('Failed to update widget data:', error);
  }
};

export const getWidgetData = async (): Promise<WidgetData | null> => {
  try {
    const { value } = await Preferences.get({ key: WIDGET_STORAGE_KEY });
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Failed to get widget data:', error);
    return null;
  }
};
