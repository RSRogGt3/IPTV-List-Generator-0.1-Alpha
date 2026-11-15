import {
  Cloud,
  FolderInput,
  ListVideo,
  LogOut,
  MessageSquare,
  MonitorPlay,
  Network,
  Radio,
  RefreshCw,
  X,
} from 'lucide-react';
import { Playlist } from '../lib/types';

export type NavView =
  | 'channels'
  | 'playlists'
  | 'sources'
  | 'ip-generator'
  | 'ai'
  | 'import-export';

interface SidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
  playlists: Playlist[];
  selectedPlaylistId: string | null;
  onSelectPlaylist: (playlistId: string) => void;
  channelCount: number;
  sourceCount: number;
  conflictCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  user: { uid: string; displayName: string | null; email: string | null } | null;
  authLoading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenTestPlayer: () => void;
}

const NAV_ITEMS: {
  id: NavView;
  label: string;
  icon: typeof Radio;
}[] = [
  { id: 'channels', label: 'Kanäle & IPs', icon: Radio },
  { id: 'playlists', label: 'Playlists', icon: ListVideo },
  { id: 'sources', label: 'Quellen & Auto-Sync', icon: RefreshCw },
  { id: 'ip-generator', label: 'IP-Generator', icon: Network },
  { id: 'ai', label: 'KI-Assistent', icon: MessageSquare },
  { id: 'import-export', label: 'Import & Export', icon: FolderInput },
];

export function Sidebar({
  activeView,
  onSelectView,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  channelCount,
  sourceCount,
  conflictCount,
  mobileOpen,
  onCloseMobile,
  user,
  authLoading,
  onSignIn,
  onSignOut,
  onOpenTestPlayer,
}: SidebarProps) {
  const sidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200 w-[248px]">
      <div className="flex items-center justify-between h-16 px-5 border-b border-slate-200 shrink-0">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('channels');
            onCloseMobile();
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
        >
          StreamGrid DE
        </a>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Seitenleiste schließen"
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Hauptnavigation" className="px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </span>
              {item.id === 'channels' && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {channelCount}
                </span>
              )}
              {item.id === 'playlists' && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {playlists.length}
                </span>
              )}
              {item.id === 'sources' && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {sourceCount}
                </span>
              )}
              {item.id === 'ip-generator' && conflictCount > 0 && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    isActive ? 'text-amber-300' : 'text-red-600'
                  }`}
                >
                  {conflictCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-5 pt-4 pb-2 border-t border-slate-200">
        <div className="text-xs font-semibold text-slate-500">
          Verknüpfte Playlists
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
        {playlists.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            Noch keine Playlists erstellt.
          </p>
        ) : (
          playlists.map((pl) => {
            const isSelected =
              activeView === 'playlists' && selectedPlaylistId === pl.id;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => {
                  onSelectPlaylist(pl.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isSelected
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="truncate">{pl.name}</span>
                <span className="font-mono text-xs tabular-nums text-slate-400 shrink-0">
                  {pl.channelIds.length}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Quick Launch Test Video Player */}
      <div className="px-3 py-2.5 border-t border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => {
            onOpenTestPlayer();
            onCloseMobile();
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200/80 transition-colors whitespace-nowrap shrink-0"
        >
          <MonitorPlay className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <span>Test-Video-Player</span>
        </button>
      </div>

      {/* Firebase Cloud Sync Account Footer */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/70 shrink-0">
        {user ? (
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">
                {user.displayName || 'Google-Konto'}
              </div>
              <div className="text-[11px] text-emerald-700 truncate">
                Cloud-Sync aktiv
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Aus Cloud-Sync abmelden"
              title="Abmelden"
              className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 shrink-0"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={authLoading}
            onClick={onSignIn}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
            <span>{authLoading ? 'Verbindet...' : 'Mit Google Cloud sichern'}</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
