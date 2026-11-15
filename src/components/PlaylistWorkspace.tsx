import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  Info,
  Loader2,
  MonitorPlay,
  Play,
  Plus,
  Trash2,
  Unlink,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { buildStreamUrl, slugifyChannelName } from '../lib/ipUtils';
import { generateM3U } from '../lib/m3u';
import {
  Channel,
  ChannelReachabilityResult,
  M3UExportMode,
  PROVIDER_META,
  Playlist,
} from '../lib/types';

interface PlaylistWorkspaceProps {
  playlists: Playlist[];
  channels: Channel[];
  selectedPlaylistId: string | null;
  onSelectPlaylist: (id: string) => void;
  onNewPlaylist: () => void;
  onEditPlaylist: (playlist: Playlist) => void;
  onDeletePlaylist: (playlist: Playlist) => void;
  onReorderChannels: (playlistId: string, newChannelIds: string[]) => Promise<void>;
  onAddChannelsToPlaylist: (playlistId: string, channelIds: string[]) => Promise<void>;
  onRemoveChannelFromPlaylist: (playlistId: string, channelId: string) => Promise<void>;
  onOpenTestPlayer: (
    channel: Channel,
    playlistChannels: Channel[],
    playlistName: string
  ) => void;
}

const EXPORT_MODES: { value: M3UExportMode; label: string }[] = [
  { value: 'auto', label: 'Auto (Upstream → Lokal)' },
  { value: 'local', label: 'Nur lokale IP-Endpunkte' },
  { value: 'upstream', label: 'Externe Upstream-URLs' },
  { value: 'proxy', label: 'Server CORS-Relay (/stream)' },
];

export function PlaylistWorkspace({
  playlists,
  channels,
  selectedPlaylistId,
  onSelectPlaylist,
  onNewPlaylist,
  onEditPlaylist,
  onDeletePlaylist,
  onReorderChannels,
  onAddChannelsToPlaylist,
  onRemoveChannelFromPlaylist,
  onOpenTestPlayer,
}: PlaylistWorkspaceProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedM3u8Url, setCopiedM3u8Url] = useState(false);
  const [copiedM3U, setCopiedM3U] = useState(false);
  const [channelToAddId, setChannelToAddId] = useState('');
  const [quickFilter, setQuickFilter] = useState('');
  const [exportMode, setExportMode] = useState<M3UExportMode>('auto');
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [publicAppUrl, setPublicAppUrl] = useState('');

  const [checkingEndpoints, setCheckingEndpoints] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [reachabilityMap, setReachabilityMap] = useState<
    Record<string, ChannelReachabilityResult>
  >({});

  useEffect(() => {
    let mounted = true;
    api
      .getPublicConfig()
      .then((res) => {
        if (mounted && res.appUrl) {
          setPublicAppUrl(res.appUrl.replace(/\/+$/, ''));
        }
      })
      .catch(() => {
        // Fallback to window.location.origin
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activePlaylist = useMemo(
    () =>
      playlists.find((p) => p.id === selectedPlaylistId) ?? playlists[0] ?? null,
    [playlists, selectedPlaylistId]
  );

  useEffect(() => {
    setCheckError(null);
  }, [activePlaylist?.id]);

  const channelMap = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels]
  );

  const linkedChannels = useMemo(() => {
    if (!activePlaylist) return [];
    return activePlaylist.channelIds
      .map((id) => channelMap.get(id))
      .filter((c): c is Channel => Boolean(c));
  }, [activePlaylist, channelMap]);

  const playableCount = useMemo(
    () => linkedChannels.filter((c) => Boolean(c.upstreamUrl)).length,
    [linkedChannels]
  );
  const lanOnlyCount = linkedChannels.length - playableCount;

  const unlinkedChannels = useMemo(() => {
    if (!activePlaylist) return [];
    const linkedSet = new Set(activePlaylist.channelIds);
    const q = quickFilter.trim().toLowerCase();
    return channels.filter((c) => {
      if (linkedSet.has(c.id)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        PROVIDER_META[c.provider].shortLabel.toLowerCase().includes(q)
      );
    });
  }, [activePlaylist, channels, quickFilter]);

  const isDevPreview =
    typeof window !== 'undefined' &&
    window.location.hostname.startsWith('ais-dev-');

  const playerOrigin = useMemo(() => {
    if (publicAppUrl && !publicAppUrl.includes('ais-dev-')) {
      return publicAppUrl;
    }
    if (typeof window === 'undefined') return '';
    if (window.location.hostname.startsWith('ais-dev-')) {
      const sharedHost = window.location.hostname.replace(
        /^ais-dev-/,
        'ais-pre-'
      );
      const portSuffix = window.location.port ? `:${window.location.port}` : '';
      return `${window.location.protocol}//${sharedHost}${portSuffix}`;
    }
    return window.location.origin;
  }, [publicAppUrl]);

  const m3uContent = useMemo(() => {
    if (!activePlaylist) return '';
    return generateM3U(activePlaylist, channels, {
      mode: exportMode,
      origin: playerOrigin,
      playableOnly: onlyPlayable,
    });
  }, [activePlaylist, channels, exportMode, playerOrigin, onlyPlayable]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (exportMode !== 'auto') params.set('mode', exportMode);
    if (onlyPlayable) params.set('playable', '1');
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
  }, [exportMode, onlyPlayable]);

  const livePlaylistUrl = activePlaylist
    ? `${playerOrigin}/api/playlists/${activePlaylist.id}/export.m3u${queryString}`
    : '';
  const livePlaylistUrlM3u8 = activePlaylist
    ? `${playerOrigin}/api/playlists/${activePlaylist.id}/export.m3u8${queryString}`
    : '';

  const reachabilitySummary = useMemo(() => {
    const items = linkedChannels
      .map((ch) => reachabilityMap[ch.id])
      .filter((r): r is ChannelReachabilityResult => Boolean(r));
    if (items.length === 0) return null;
    return {
      total: items.length,
      reachable: items.filter((r) => r.status === 'reachable').length,
      privateLan: items.filter((r) => r.status === 'private-lan').length,
      failed: items.filter(
        (r) =>
          r.status === 'unreachable' ||
          r.status === 'timeout' ||
          r.status === 'invalid'
      ).length,
    };
  }, [linkedChannels, reachabilityMap]);

  const handleCopyUrl = async () => {
    if (!livePlaylistUrl) return;
    try {
      await navigator.clipboard.writeText(livePlaylistUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyM3u8Url = async () => {
    if (!livePlaylistUrlM3u8) return;
    try {
      await navigator.clipboard.writeText(livePlaylistUrlM3u8);
      setCopiedM3u8Url(true);
      setTimeout(() => setCopiedM3u8Url(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyM3U = async () => {
    if (!m3uContent) return;
    try {
      await navigator.clipboard.writeText(m3uContent);
      setCopiedM3U(true);
      setTimeout(() => setCopiedM3U(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownloadM3U = (ext: 'm3u' | 'm3u8') => {
    if (!activePlaylist) return;
    const mimeType =
      ext === 'm3u8'
        ? 'application/vnd.apple.mpegurl;charset=utf-8'
        : 'audio/x-mpegurl;charset=utf-8';
    const blob = new Blob([m3uContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugifyChannelName(activePlaylist.name)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCheckEndpoints = async () => {
    if (linkedChannels.length === 0 || checkingEndpoints) return;
    setCheckingEndpoints(true);
    setCheckError(null);
    try {
      const res = await api.checkEndpoints(linkedChannels);
      setReachabilityMap((prev) => {
        const next = { ...prev };
        for (const item of res.results) {
          next[item.channelId] = item;
        }
        return next;
      });
    } catch (err) {
      setCheckError(
        err instanceof Error
          ? err.message
          : 'Endpunkt-Prüfung fehlgeschlagen.'
      );
    } finally {
      setCheckingEndpoints(false);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!activePlaylist) return;
    const next = [...activePlaylist.channelIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    await onReorderChannels(activePlaylist.id, next);
  };

  const handleAddSelectedChannel = async () => {
    if (!activePlaylist) return;
    const idToAdd = channelToAddId || unlinkedChannels[0]?.id;
    if (!idToAdd) return;
    await onAddChannelsToPlaylist(activePlaylist.id, [idToAdd]);
    setChannelToAddId('');
  };

  if (playlists.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-12 text-center">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Noch keine Playlists vorhanden
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
          Erstelle deine erste Playlist, um Sky, Netflix, Amazon Prime, Disney+ und deutsche Sender mit ihren IP-Adressen zu bündeln.
        </p>
        <button
          type="button"
          onClick={onNewPlaylist}
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Erste Playlist erstellen</span>
        </button>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Master Column: Playlists */}
      <section
        aria-label="Alle Playlists"
        className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Alle Playlists ({playlists.length})
          </h2>
          <button
            type="button"
            onClick={onNewPlaylist}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Neu</span>
          </button>
        </div>

        <div className="divide-y divide-slate-200">
          {playlists.map((pl) => {
            const isSelected = activePlaylist?.id === pl.id;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => onSelectPlaylist(pl.id)}
                className={`w-full text-left px-4 py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-600 ${
                  isSelected
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{pl.name}</span>
                  <span
                    className={`font-mono text-xs tabular-nums shrink-0 ${
                      isSelected ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {pl.channelIds.length} Kanäle
                  </span>
                </div>
                {pl.description && (
                  <p
                    className={`mt-1 text-xs line-clamp-2 ${
                      isSelected ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {pl.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Right Detail Column */}
      {activePlaylist && (
        <div className="xl:col-span-8 space-y-6">
          {/* Playlist Header & Live M3U URL */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-xl font-semibold text-slate-900">
                  {activePlaylist.name}
                </h1>
                {activePlaylist.description && (
                  <p className="mt-1 text-sm text-slate-600">
                    {activePlaylist.description}
                  </p>
                )}
                <div className="mt-2 text-xs text-slate-500 tabular-nums">
                  {linkedChannels.length} verknüpfte Kanäle ({playableCount} online-abspielbar · {lanOnlyCount} nur LAN) · Protokoll:{' '}
                  {activePlaylist.protocolOverride === 'channel' ||
                  !activePlaylist.protocolOverride
                    ? 'Kanal-Standard'
                    : activePlaylist.protocolOverride.toUpperCase()}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onEditPlaylist(activePlaylist)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Bearbeiten</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePlaylist(activePlaylist)}
                  aria-label={`Playlist "${activePlaylist.name}" löschen`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 bg-white border border-slate-200 rounded-md hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Löschen</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                <label
                  htmlFor="playlist-export-mode"
                  className="text-xs font-semibold text-slate-700"
                >
                  Zentrale M3U-Abruf-URL (VLC, Kodi, TiviMate, Web-Player)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={onlyPlayable}
                      onChange={(e) => setOnlyPlayable(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>Nur online abspielbare Kanäle (VLC / Web)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 shrink-0">
                      Stream-Modus:
                    </span>
                    <select
                      id="playlist-export-mode"
                      value={exportMode}
                      onChange={(e) =>
                        setExportMode(e.target.value as M3UExportMode)
                      }
                      className="px-2.5 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {EXPORT_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 font-mono text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 truncate">
                  {livePlaylistUrl}
                </code>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    {copiedUrl ? (
                      <Check
                        className="w-3.5 h-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {copiedUrl
                        ? 'Kopiert'
                        : isDevPreview
                          ? 'Shared-URL (.m3u)'
                          : '.m3u-URL kopieren'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyM3u8Url}
                    title={livePlaylistUrlM3u8}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    {copiedM3u8Url ? (
                      <Check
                        className="w-3.5 h-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{copiedM3u8Url ? 'Kopiert' : '.m3u8-URL'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadM3U('m3u')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>.m3u laden</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadM3U('m3u8')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 min-h-[38px]"
                  >
                    <span>.m3u8</span>
                  </button>
                </div>
              </div>

              {isDevPreview && (
                <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <Info
                    className="w-4 h-4 text-amber-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <div className="font-semibold">
                      Hinweis zur Entwickler-URL (ais-dev-…)
                    </div>
                    <p className="text-amber-800 leading-relaxed">
                      Die <code className="font-mono">ais-dev-</code>-Adresse ist durch deinen Google-Login geschützt – externe Player wie VLC oder TiviMate erhalten dort einen <em>Network Provider Error</em>. Nutze oben die{' '}
                      <strong>Shared-URL (<code className="font-mono">ais-pre-</code>)</strong> (App zuvor im Share-Menü freigeben) oder lade die{' '}
                      <strong>.m3u-Datei direkt herunter</strong>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Add Channel to Playlist + Linked Channels Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-sm font-semibold text-slate-900 whitespace-nowrap shrink-0">
                  Verknüpfte Kanäle & Reihenfolge
                </h2>
                <button
                  type="button"
                  disabled={linkedChannels.length === 0 || checkingEndpoints}
                  onClick={handleCheckEndpoints}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  {checkingEndpoints ? (
                    <Loader2
                      className="w-3.5 h-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {checkingEndpoints
                      ? 'Prüfe Endpunkte...'
                      : 'Endpunkte prüfen'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={linkedChannels.length === 0}
                  onClick={() => {
                    if (linkedChannels[0]) {
                      onOpenTestPlayer(
                        linkedChannels[0],
                        linkedChannels,
                        activePlaylist.name
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <MonitorPlay className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Playlist testen</span>
                </button>
              </div>

              {unlinkedChannels.length > 0 || quickFilter ? (
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    type="text"
                    value={quickFilter}
                    onChange={(e) => setQuickFilter(e.target.value)}
                    placeholder="Kanal filtern..."
                    aria-label="Verfügbare Kanäle zum Hinzufügen filtern"
                    className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md w-32 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <select
                    aria-label="Kanal zum Verknüpfen auswählen"
                    value={channelToAddId || unlinkedChannels[0]?.id || ''}
                    onChange={(e) => setChannelToAddId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white max-w-[190px] focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {unlinkedChannels.length === 0 ? (
                      <option value="">Kein Treffer</option>
                    ) : (
                      unlinkedChannels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.name} ({PROVIDER_META[ch.provider].shortLabel})
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    disabled={unlinkedChannels.length === 0}
                    onClick={handleAddSelectedChannel}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Hinzufügen</span>
                  </button>
                </div>
              ) : (
                <span className="text-xs text-slate-500">
                  Alle verfügbaren Kanäle sind bereits verknüpft.
                </span>
              )}
            </div>

            {checkError && (
              <div
                role="alert"
                className="px-5 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-700 flex items-center gap-2"
              >
                <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{checkError}</span>
              </div>
            )}

            {reachabilitySummary && (
              <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1 tabular-nums">
                <span className="font-semibold text-slate-900">
                  Diagnose ({reachabilitySummary.total} geprüft):
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {reachabilitySummary.reachable} erreichbar
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                  {reachabilitySummary.privateLan} privates Heimnetz (nur im LAN)
                </span>
                <span className="inline-flex items-center gap-1 text-red-700">
                  <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                  {reachabilitySummary.failed} nicht erreichbar
                </span>
              </div>
            )}

            {linkedChannels.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Diese Playlist enthält noch keine Kanäle. Wähle oben einen Kanal aus oder verknüpfe Kanäle über die zentrale Kanaltabelle.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                      <th className="py-2.5 pl-5 pr-2 w-12">#</th>
                      <th className="py-2.5 px-3">Kanal</th>
                      <th className="py-2.5 px-3">Exportierte Stream-URL</th>
                      <th className="py-2.5 px-3">Erreichbarkeit</th>
                      <th className="py-2.5 pl-3 pr-5 text-right">
                        Reihenfolge / Entfernen
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {linkedChannels.map((ch, idx) => {
                      const check = reachabilityMap[ch.id];
                      const effectiveUrl = buildStreamUrl(
                        ch,
                        activePlaylist.protocolOverride,
                        { mode: exportMode, origin: playerOrigin }
                      );
                      return (
                        <tr key={ch.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 pl-5 pr-2 font-mono text-xs text-slate-400 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">
                              {ch.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {PROVIDER_META[ch.provider].shortLabel} ·{' '}
                              {ch.category}
                              {ch.upstreamUrl ? ' · Upstream hinterlegt' : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 max-w-[260px]">
                            <code
                              title={effectiveUrl}
                              className="block font-mono text-xs text-slate-700 tabular-nums truncate"
                            >
                              {effectiveUrl}
                            </code>
                          </td>
                          <td className="py-2.5 px-3 text-xs">
                            {!check ? (
                              <span className="text-slate-400">
                                Nicht geprüft
                              </span>
                            ) : check.status === 'reachable' ? (
                              <div className="inline-flex items-center gap-1.5 text-emerald-700">
                                <CheckCircle2
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span className="tabular-nums">
                                  Erreichbar
                                  {check.httpStatus
                                    ? ` (${check.httpStatus})`
                                    : ''}
                                  {check.latencyMs !== undefined
                                    ? ` · ${check.latencyMs} ms`
                                    : ''}
                                </span>
                              </div>
                            ) : check.status === 'private-lan' ? (
                              <div
                                title={check.detail}
                                className="inline-flex items-center gap-1.5 text-amber-700"
                              >
                                <AlertTriangle
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Nur lokales Heimnetz (LAN)</span>
                              </div>
                            ) : (
                              <div
                                title={check.detail}
                                className="inline-flex items-center gap-1.5 text-red-700"
                              >
                                <WifiOff
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>
                                  {check.status === 'timeout'
                                    ? 'Zeitüberschreitung'
                                    : 'Nicht erreichbar'}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenTestPlayer(
                                    ch,
                                    linkedChannels,
                                    activePlaylist.name
                                  )
                                }
                                aria-label={`${ch.name} im Test-Player öffnen`}
                                title="Im Test-Video-Player testen"
                                className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                              >
                                <Play className="w-4 h-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMove(idx, -1)}
                                aria-label={`${ch.name} nach oben verschieben`}
                                className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30"
                              >
                                <ArrowUp
                                  className="w-4 h-4"
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                disabled={idx === linkedChannels.length - 1}
                                onClick={() => handleMove(idx, 1)}
                                aria-label={`${ch.name} nach unten verschieben`}
                                className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30"
                              >
                                <ArrowDown
                                  className="w-4 h-4"
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onRemoveChannelFromPlaylist(
                                    activePlaylist.id,
                                    ch.id
                                  )
                                }
                                aria-label={`${ch.name} aus Playlist entfernen`}
                                title="Aus Playlist entfernen"
                                className="inline-flex items-center justify-center w-8 h-8 rounded text-slate-500 hover:text-red-600 hover:bg-red-50"
                              >
                                <Unlink
                                  className="w-4 h-4"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Live M3U Preview */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Live-Vorschau (#EXTM3U)
              </h2>
              <button
                type="button"
                onClick={handleCopyM3U}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                {copiedM3U ? (
                  <Check
                    className="w-3.5 h-3.5 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedM3U ? 'Inhalt kopiert' : 'M3U-Text kopieren'}</span>
              </button>
            </div>
            <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto max-h-72 leading-relaxed">
              {m3uContent}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
