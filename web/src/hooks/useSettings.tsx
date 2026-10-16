import { createContext, useContext, type ReactNode } from 'react';
import type { Settings } from '../api/types';

const DEFAULTS: Settings = { timeZone: 'Asia/Kolkata', currency: 'INR', pageSize: 20 };
const SettingsContext = createContext<Settings>(DEFAULTS);

export function SettingsProvider({ value, children }: { value: Settings | undefined; children: ReactNode }) {
  return <SettingsContext.Provider value={value ?? DEFAULTS}>{children}</SettingsContext.Provider>;
}

/** Hospital settings from GET /api/settings: time zone for every date shown, currency for fees. */
export function useSettings(): Settings {
  return useContext(SettingsContext);
}
