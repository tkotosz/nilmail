import { restoreSettings } from '../core/settings.ts';
import type { Settings } from '../core/types.ts';

const settingsKey = 'nilmail.settings.v3';
/** Settings from before piles, newest first; `restoreSettings` turns them into piles. */
const oldSettingsKeys = ['nilmail.settings.v2', 'nilmail.settings.v1'];

export function loadSettings(): Settings {
  try {
    const saved = [settingsKey, ...oldSettingsKeys].map(key => localStorage.getItem(key)).find(value => value !== null);
    return restoreSettings(JSON.parse(saved ?? 'null'));
  } catch {
    return restoreSettings(null);
  }
}

/** Saves the settings; returns false when the browser refuses. */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    for (const key of oldSettingsKeys) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
