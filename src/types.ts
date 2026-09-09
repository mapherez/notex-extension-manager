export type ExtensionStatus =
  | 'readyToInstall'
  | 'installed'
  | 'updateReady'
  | 'locallyModified'
  | 'unavailable'
  | 'error';

export type ExtensionView = {
  id: string;
  name: string;
  description: string;
  localVersion: string | null;
  installedVersion: string | null;
  availableVersion: string | null;
  iconPath: string | null;
  status: ExtensionStatus;
  problem: string | null;
};

export type ManagerSnapshot = {
  extensions: ExtensionView[];
  lastSyncedAt: string | null;
  repositoryUrl: string;
};

export type ExtensionActionResult = {
  message: string;
  snapshot: ManagerSnapshot;
};

export type ExtensionAction = 'install' | 'update' | 'remove' | 'repair';
