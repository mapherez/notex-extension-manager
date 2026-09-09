import { beforeEach, describe, expect, it } from 'vitest';
import { useAppUpdaterStore } from './useAppUpdaterStore';

describe('app updater banner persistence', () => {
  beforeEach(() => {
    useAppUpdaterStore.setState({
      status: 'idle',
      updateInfo: null,
      progress: null,
      checkedAt: null,
      bannerVisible: false,
      error: null,
    });
  });

  it('keeps the available update state when Later closes the banner', () => {
    useAppUpdaterStore.setState({ status: 'available', bannerVisible: true });
    useAppUpdaterStore.getState().dismissBanner();
    expect(useAppUpdaterStore.getState().status).toBe('available');
    expect(useAppUpdaterStore.getState().bannerVisible).toBe(false);
  });

  it('reopens a dismissed banner from the footer control', () => {
    useAppUpdaterStore.setState({ status: 'available', bannerVisible: false });
    useAppUpdaterStore.getState().showBanner();
    expect(useAppUpdaterStore.getState().bannerVisible).toBe(true);
  });
});
