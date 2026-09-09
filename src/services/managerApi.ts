import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExtensionAction, ExtensionActionResult, ManagerSnapshot } from '../types';

const repositoryUrl = 'https://github.com/mapherez/notex-extension-manager';

const browserPreview: ManagerSnapshot = {
  repositoryUrl,
  lastSyncedAt: new Date().toISOString(),
  extensions: [
    {
      id: 'better-bookmarks',
      name: 'Better Bookmarks',
      description: 'Bookmark manager for Chrome',
      localVersion: '1.4.0',
      installedVersion: '1.4.0',
      availableVersion: '1.5.0',
      iconPath: null,
      status: 'updateReady',
      problem: null,
    },
    {
      id: 'nox-tools',
      name: 'NoX Tools',
      description: 'Small utilities for Chrome',
      localVersion: '2.1.0',
      installedVersion: null,
      availableVersion: '2.1.0',
      iconPath: null,
      status: 'readyToInstall',
      problem: null,
    },
    {
      id: 'tab-manager',
      name: 'Tab Manager',
      description: 'Organize your tabs and sessions',
      localVersion: '1.8.2',
      installedVersion: '1.8.2',
      availableVersion: '1.8.2',
      iconPath: null,
      status: 'installed',
      problem: null,
    },
  ],
};

export async function getSnapshot() {
  if (!isTauri()) return browserPreview;
  return invoke<ManagerSnapshot>('get_snapshot');
}

export async function syncExtensions() {
  if (!isTauri()) return browserPreview;
  return invoke<ManagerSnapshot>('sync_extensions');
}

export async function runExtensionAction(action: ExtensionAction, id: string) {
  if (!isTauri()) {
    return { message: `${action} preview completed`, snapshot: browserPreview };
  }
  return invoke<ExtensionActionResult>(`${action}_extension`, { id });
}

export function localIconUrl(path: string | null) {
  return path && isTauri() ? convertFileSrc(path) : null;
}
