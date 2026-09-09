import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertTriangle, Check, CheckCircle2, Circle, Download, Github, Minus, Package,
  RefreshCw, RotateCcw, Search, Square, Trash2, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { localIconUrl } from './services/managerApi';
import { useAppUpdaterStore, type AppUpdaterStatus } from './store/useAppUpdaterStore';
import { useManagerStore } from './store/useManagerStore';
import type { ExtensionAction, ExtensionStatus, ExtensionView } from './types';

const statusCopy: Record<ExtensionStatus, string> = {
  readyToInstall: 'Ready to install', installed: 'Installed', updateReady: 'Update ready',
  locallyModified: 'Locally modified', unavailable: 'Unavailable', error: 'Error',
};

function App() {
  const snapshot = useManagerStore((state) => state.snapshot);
  const loading = useManagerStore((state) => state.loading);
  const syncing = useManagerStore((state) => state.syncing);
  const syncError = useManagerStore((state) => state.syncError);
  const activeExtensionId = useManagerStore((state) => state.activeExtensionId);
  const error = useManagerStore((state) => state.error);
  const notice = useManagerStore((state) => state.notice);
  const initialize = useManagerStore((state) => state.initialize);
  const sync = useManagerStore((state) => state.sync);
  const runAction = useManagerStore((state) => state.runAction);
  const retry = useManagerStore((state) => state.retry);
  const clearError = useManagerStore((state) => state.clearError);
  const clearNotice = useManagerStore((state) => state.clearNotice);
  const checkAppUpdate = useAppUpdaterStore((state) => state.check);
  const [query, setQuery] = useState('');
  const [removeTarget, setRemoveTarget] = useState<ExtensionView | null>(null);

  useEffect(() => { void initialize(); void checkAppUpdate(true); }, [checkAppUpdate, initialize]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(clearNotice, 3600);
    return () => window.clearTimeout(timeout);
  }, [clearNotice, notice]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snapshot?.extensions ?? [];
    return (snapshot?.extensions ?? []).filter((extension) =>
      `${extension.name} ${extension.description} ${extension.id}`.toLowerCase().includes(normalized));
  }, [query, snapshot?.extensions]);

  const act = (action: ExtensionAction, id: string) => { void runAction(action, id); };

  return (
    <div className="app-shell">
      <Titlebar />
      <AppUpdateBanner />
      <main className="workspace">
        <header className="page-header">
          <div><p className="eyebrow">LOCAL CHROME LIBRARY</p><h1>Extensions</h1></div>
          <div className="sync-cluster">
            <button className="button button-secondary sync-button" onClick={() => void sync()} disabled={syncing}>
              <RefreshCw size={19} className={syncing ? 'spin' : undefined} />
              {syncing ? 'Syncing…' : 'Sync extensions'}
            </button>
            <span className={syncError ? 'sync-copy sync-copy-error' : 'sync-copy'}>
              {syncStatus(syncing, syncError, snapshot?.lastSyncedAt ?? null)}
            </span>
          </div>
        </header>
        <label className="search-box">
          <Search size={23} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search extensions…" aria-label="Search extensions" />
        </label>
        <section className="extension-list" aria-busy={loading || syncing} aria-live="polite">
          {loading && !snapshot ? <LoadingCards /> : null}
          {!loading && filtered.length === 0 ? (
            <div className="empty-state"><Package size={34} />
              <strong>{query ? 'No matching extensions' : 'No extensions available yet'}</strong>
              <span>{query ? 'Try a different search.' : 'Sync the repository to look for extensions.'}</span>
            </div>) : null}
          {filtered.map((extension, index) => (
            <ExtensionCard key={extension.id} extension={extension} index={index}
              busy={activeExtensionId === extension.id}
              disabled={Boolean(activeExtensionId && activeExtensionId !== extension.id)}
              onAction={act} onRemove={() => setRemoveTarget(extension)} />
          ))}
        </section>
      </main>
      <AppFooter />
      {removeTarget ? <ConfirmDialog extension={removeTarget} onCancel={() => setRemoveTarget(null)}
        onConfirm={() => { act('remove', removeTarget.id); setRemoveTarget(null); }} /> : null}
      {error ? <ErrorDialog message={error} repositoryUrl={snapshot?.repositoryUrl}
        onClose={clearError} onRetry={() => void retry()} /> : null}
      {notice ? <div className="toast"><CheckCircle2 size={18} />{notice}</div> : null}
    </div>
  );
}

function Titlebar() {
  const appWindow = getCurrentWindow();
  return <header className="titlebar" data-tauri-drag-region onDoubleClick={() => void appWindow.toggleMaximize()}>
    <div className="brand" data-tauri-drag-region><img src="/assets/nox_logo.png" alt="" />
      <span data-tauri-drag-region>NoX Extension Manager</span></div>
    <div className="window-controls">
      <button aria-label="Minimize" onClick={() => void appWindow.minimize()}><Minus size={18} /></button>
      <button aria-label="Maximize or restore" onClick={() => void appWindow.toggleMaximize()}><Square size={15} /></button>
      <button className="close-control" aria-label="Close" onClick={() => void appWindow.close()}><X size={20} /></button>
    </div>
  </header>;
}

type CardProps = { extension: ExtensionView; index: number; busy: boolean; disabled: boolean;
  onAction: (action: ExtensionAction, id: string) => void; onRemove: () => void };

function ExtensionCard({ extension, index, busy, disabled, onAction, onRemove }: CardProps) {
  const iconUrl = localIconUrl(extension.iconPath);
  const installed = Boolean(extension.installedVersion);
  return <article className={`extension-card status-${extension.status}`}>
    <div className={`extension-icon extension-icon-${index % 4}`}>
      {iconUrl ? <img src={iconUrl} alt="" /> : <Package size={35} />}
    </div>
    <div className="extension-copy"><h2>{extension.name}</h2>
      <p>{extension.description || 'Chrome extension'}</p><VersionLine extension={extension} />
      {extension.problem ? <span className="problem-copy">{extension.problem}</span> : null}
    </div>
    <div className={`status-pill pill-${extension.status}`}><StatusIcon status={extension.status} />{statusCopy[extension.status]}</div>
    <div className="card-actions">
      {extension.status === 'readyToInstall' ? <button className="button button-primary" disabled={busy || disabled}
        onClick={() => onAction('install', extension.id)}>{busy ? <RefreshCw className="spin" size={18} /> : <Download size={18} />} Install</button> : null}
      {extension.status === 'updateReady' ? <button className="button button-primary" disabled={busy || disabled}
        onClick={() => onAction('update', extension.id)}>{busy ? <RefreshCw className="spin" size={18} /> : <RefreshCw size={18} />} Update</button> : null}
      {(extension.status === 'error' || extension.status === 'locallyModified') && installed ?
        <button className="button button-secondary" disabled={busy || disabled} onClick={() => onAction('repair', extension.id)}>
          <RotateCcw size={18} /> Repair</button> : null}
      {installed ? <button className="button button-danger" disabled={busy || disabled} onClick={onRemove}>
        <Trash2 size={18} /> Remove</button> : null}
    </div>
  </article>;
}

function VersionLine({ extension }: { extension: ExtensionView }) {
  if (extension.status === 'updateReady') return <span className="version-copy">
    Installed v{extension.installedVersion ?? extension.localVersion} <span>→</span> Available v{extension.availableVersion}</span>;
  return <span className="version-copy">v{extension.installedVersion ?? extension.localVersion ?? extension.availableVersion ?? '—'}</span>;
}

function StatusIcon({ status }: { status: ExtensionStatus }) {
  if (status === 'installed') return <Check size={17} />;
  if (status === 'updateReady') return <RefreshCw size={16} />;
  if (status === 'locallyModified' || status === 'unavailable' || status === 'error') return <AlertTriangle size={16} />;
  return <Circle size={16} />;
}

function AppUpdateBanner() {
  const status = useAppUpdaterStore((state) => state.status);
  const info = useAppUpdaterStore((state) => state.updateInfo);
  const progress = useAppUpdaterStore((state) => state.progress);
  const visible = useAppUpdaterStore((state) => state.bannerVisible);
  const dismiss = useAppUpdaterStore((state) => state.dismissBanner);
  const install = useAppUpdaterStore((state) => state.install);
  if (!visible || !info) return null;
  const installing = status === 'installing';
  return <aside className="update-banner" role="status">
    <div className="update-banner-icon"><Download size={21} /></div>
    <div><strong>NoX update v{info.version} is available</strong><span>Current version: {info.currentVersion}</span>
      {installing ? <progress max={100} value={progress?.percent ?? undefined} /> : null}</div>
    <div className="update-banner-actions"><button className="button button-primary" disabled={installing} onClick={() => void install()}>
      {installing ? `Installing${progress?.percent != null ? ` ${progress.percent}%` : '…'}` : 'Install now'}</button>
      <button className="button button-ghost" disabled={installing} onClick={dismiss}>Later</button></div>
  </aside>;
}

function AppFooter() {
  const status = useAppUpdaterStore((state) => state.status);
  const info = useAppUpdaterStore((state) => state.updateInfo);
  const checkedAt = useAppUpdaterStore((state) => state.checkedAt);
  const check = useAppUpdaterStore((state) => state.check);
  const showBanner = useAppUpdaterStore((state) => state.showBanner);
  const available = status === 'available' || status === 'installing';
  return <footer className="app-footer">
    <button className={available ? 'app-update-control update-available' : 'app-update-control'}
      onClick={() => available ? showBanner() : void check(true)} disabled={status === 'checking' || status === 'installing'}>
      <span className="footer-icon"><RefreshCw size={17} className={status === 'checking' ? 'spin' : undefined} /></span>
      <span>{appUpdateStatus(status, info?.version, checkedAt)}</span></button>
    <span className="footer-version">NoX Extension Manager · v0.1.0</span>
  </footer>;
}

function ConfirmDialog({ extension, onCancel, onConfirm }: { extension: ExtensionView; onCancel: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
    <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title">
      <div className="dialog-icon danger"><Trash2 size={22} /></div><h2 id="remove-title">Remove {extension.name} from Chrome?</h2>
      <p>The local files will stay in Documents, ready to install again.</p>
      <div className="dialog-actions"><button className="button button-secondary" onClick={onCancel}>Cancel</button>
        <button className="button button-danger-solid" onClick={onConfirm}>Remove</button></div>
    </section></div>;
}

function ErrorDialog({ message, repositoryUrl, onClose, onRetry }: { message: string; repositoryUrl?: string; onClose: () => void; onRetry: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="error-title">
    <div className="dialog-icon warning"><AlertTriangle size={23} /></div><h2 id="error-title">NoX could not complete the action</h2><p>{message}</p>
    <div className="dialog-actions dialog-actions-spread"><button className="button button-ghost"
      onClick={() => void openUrl(repositoryUrl ?? 'https://github.com/mapherez/notex-extension-manager')}><Github size={17} /> Open GitHub</button>
      <div><button className="button button-secondary" onClick={onClose}>Close</button><button className="button button-primary" onClick={onRetry}>Retry</button></div>
    </div></section></div>;
}

function LoadingCards() { return <>{[0, 1, 2].map((item) => <div className="extension-card skeleton" key={item} />)}</>; }

function syncStatus(syncing: boolean, error: string | null, date: string | null) {
  if (syncing) return 'Checking the GitHub repository';
  if (error) return 'Sync failed · click to retry';
  if (!date) return 'Not synced yet';
  const checked = new Date(date);
  if (Date.now() - checked.getTime() < 60_000) return 'Last synced just now';
  return `Last synced at ${checked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function appUpdateStatus(status: AppUpdaterStatus, version?: string, checkedAt?: string | null) {
  if (status === 'checking') return 'Checking for app updates…';
  if (status === 'installing') return `Installing app update${version ? ` v${version}` : ''}…`;
  if (status === 'available') return `App update v${version} available`;
  if (status === 'upToDate') { const time = checkedAt ? new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `App is up to date${time ? ` · Checked at ${time}` : ''}`; }
  if (status === 'failed') return 'Update check failed · Retry';
  return 'Check for app updates';
}

export default App;
