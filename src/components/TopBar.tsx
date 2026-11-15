import { Menu, Plus } from 'lucide-react';
import { NavView } from './Sidebar';

interface TopBarProps {
  activeView: NavView;
  selectedPlaylistName?: string;
  onOpenMobileMenu: () => void;
  onNewChannel: () => void;
  onNewPlaylist: () => void;
}

const VIEW_LABELS: Record<NavView, string> = {
  channels: 'Kanäle & IP-Verwaltung',
  playlists: 'Playlists & M3U-Ausgabe',
  sources: 'Quellen & automatische Kanallisten',
  'ip-generator': 'IP-Profile & Generator',
  ai: 'KI-Assistent & Live-Suche',
  'import-export': 'Import & Export',
};

const VIEW_SHORT_LABELS: Record<NavView, string> = {
  channels: 'Kanäle & IPs',
  playlists: 'Playlists',
  sources: 'Quellen',
  'ip-generator': 'IP-Generator',
  ai: 'KI-Assistent',
  'import-export': 'Import',
};

export function TopBar({
  activeView,
  selectedPlaylistName,
  onOpenMobileMenu,
  onNewChannel,
  onNewPlaylist,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Navigation öffnen"
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 shrink-0"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 whitespace-nowrap shrink-0 hidden sm:inline">
            Zentrale
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="font-medium text-slate-900 whitespace-nowrap sm:hidden">
            {VIEW_SHORT_LABELS[activeView]}
          </span>
          <span className="font-medium text-slate-900 truncate hidden sm:inline">
            {VIEW_LABELS[activeView]}
          </span>
          {activeView === 'playlists' && selectedPlaylistName && (
            <>
              <span className="text-slate-300 hidden md:inline" aria-hidden="true">
                /
              </span>
              <span className="text-slate-600 truncate hidden md:inline max-w-[240px]">
                {selectedPlaylistName}
              </span>
            </>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onNewPlaylist}
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="sm:hidden">Playlist</span>
          <span className="hidden sm:inline">Neue Playlist</span>
        </button>
        <button
          type="button"
          onClick={onNewChannel}
          className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 min-h-[40px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="sm:hidden">Kanal</span>
          <span className="hidden sm:inline">Neuer Kanal</span>
        </button>
      </div>
    </header>
  );
}
