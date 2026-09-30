import { writable } from 'svelte/store';
import type { ThemePreset } from '$lib/themes';
import { applyThemePreset } from '$lib/themes';

export type Theme = 'light' | 'dark';

export const theme = writable<Theme>('light');
export const themePreset = writable<ThemePreset>('typora');

export function toggleTheme() {
  theme.update(current => {
    const newTheme = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    return newTheme;
  });
}

export function setTheme(newTheme: Theme) {
  theme.set(newTheme);
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}

export function setThemePreset(preset: ThemePreset) {
  themePreset.set(preset);
  applyThemePreset(preset);
}
