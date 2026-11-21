import { restoreSettings } from '../core/settings.ts';
import type { Settings } from '../core/types.ts';

const settingsKey = 'nilmail.settings.v1';

export function loadSettings(): Settings {
  try {
    return restoreSettings(JSON.parse(localStorage.getItem(settingsKey) ?? 'null'));
  } catch {
    return restoreSettings(null);
  }
}

/** Saves the settings; returns false when the browser refuses. */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
