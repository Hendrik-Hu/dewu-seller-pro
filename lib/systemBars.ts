import { registerPlugin } from '@capacitor/core';

interface SystemBarsPlugin {
  setTheme(options: { dark: boolean }): Promise<{ dark: boolean }>;
}

export const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars');
