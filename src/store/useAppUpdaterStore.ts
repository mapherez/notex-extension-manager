import { create } from 'zustand';
import { checkForAppUpdate, installAppUpdate, type AppUpdateInfo, type UpdateProgress } from '../services/appUpdater';

export type AppUpdaterStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'installing' | 'failed';

type AppUpdaterStore = {
  status: AppUpdaterStatus;
  updateInfo: AppUpdateInfo | null;
  progress: UpdateProgress | null;
  checkedAt: string | null;
  bannerVisible: boolean;
  error: string | null;
  check: (showBanner?: boolean) => Promise<void>;
  showBanner: () => void;
  dismissBanner: () => void;
  install: () => Promise<void>;
};

let activeCheck: Promise<void> | null = null;

export const useAppUpdaterStore = create<AppUpdaterStore>((set, get) => ({
  status: 'idle',
  updateInfo: null,
  progress: null,
  checkedAt: null,
  bannerVisible: false,
  error: null,
  check: async (showBanner = true) => {
    if (get().status === 'available' && get().updateInfo) {
      if (showBanner) set({ bannerVisible: true });
      return;
    }
    if (activeCheck) return activeCheck;
    set({ status: 'checking', error: null });
    activeCheck = checkForAppUpdate()
      .then((updateInfo) => {
        const checkedAt = new Date().toISOString();
        set({
          updateInfo,
          checkedAt,
          status: updateInfo ? 'available' : 'upToDate',
          bannerVisible: Boolean(updateInfo && showBanner),
        });
      })
      .catch((error) => {
        set({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        activeCheck = null;
      });
    return activeCheck;
  },
  showBanner: () => set({ bannerVisible: true }),
  dismissBanner: () => set({ bannerVisible: false }),
  install: async () => {
    const updateInfo = get().updateInfo;
    if (!updateInfo || get().status === 'installing') return;
    set({ status: 'installing', progress: null, error: null });
    try {
      await installAppUpdate(updateInfo.update, (progress) => set({ progress }));
    } catch (error) {
      set({ status: 'available', error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
