import { FormEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { isValidIPv4, isValidPort } from '../lib/ipUtils';
import { isValidSourceUrl } from '../lib/sourceSync';
import { Channel, Playlist, SourceSyncLogItem, StreamSource } from '../lib/types';

interface SourcesSyncViewProps {
  sources: StreamSource[];
  playlists: Playlist[];
  channels: Channel[];
  syncLogs: SourceSyncLogItem[];
  syncingIds: string[];
  syncingAll: boolean;
  onCreateSource: (payload: {
    name: string;
    url: string;
    targetPlaylistId?: string;
    targetPlaylistName?: string;
    autoRefresh: boolean;
    intervalMinutes: number;
    defaultIp: string;
    startPort: number;
  }) => Promise<void>;
  onToggleSourceAutoRefresh: (source: StreamSource) => Promise<void>;
  onToggleSourceEnabled: (source: StreamSource) => Promise<void>;
  onSyncSource: (sourceId: string) => Promise<void>;
  onSyncAllSources: () => Promise<void>;
  onDeleteSource: (source: StreamSource) => Promise<void>;
  onOpenPlaylist: (playlistId: string) => void;
}

const INTERVAL_OPTIONS = [
  { value: 1, label: 'Jede Minute' },
  { value: 5, label: 'Alle 5 Minuten' },
  { value: 15, label: 'Alle 15 Minuten' },
  { value: 30, label: 'Alle 30 Minuten' },
  { value: 60, label: 'Stündlich' },
];

function formatDateTime(iso?: string): string {
  if (!iso) return 'Noch nicht synchronisiert';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function SourcesSyncView({
  sources,
  playlists,
  channels,
  syncLogs,
  syncingIds,
  syncingAll,
  onCreateSource,
  onToggleSourceAutoRefresh,
  onToggleSourceEnabled,
  onSyncSource,
  onSyncAllSources,
  onDeleteSource,
  onOpenPlaylist,
}: SourcesSyncViewProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [playlistMode, setPlaylistMode] = useState<'existing' | 'new'>('new');
  const [targetPlaylistId, setTargetPlaylistId] = useState(
    playlists.find((p) => p.id === 'pl-auto-quellen')?.id || playlists[0]?.id || ''
  );
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [defaultIp, setDefaultIp] = useState('192.168.178.160');
  const [startPort, setStartPort] = useState('8750');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const activeAutoCount = useMemo(
    () => sources.filter((s) => s.enabled && s.autoRefresh).length,
    [sources]
  );

  const autoDiscoveredChannelsCount = useMemo(
    () =>
      channels.filter((c) => c.notes?.startsWith('Auto-Quelle:')).length,
    [channels]
  );

  const latestSyncIso = useMemo(() => {
    const timestamps = sources
      .map((s) => s.lastSyncedAt)
      .filter((t): t is string => Boolean(t))
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return timestamps[0];
  }, [sources]);

  const handleApplyPreset = (
    preset:
      | 'basis'
      | 'fast'
      | 'iptv-org-de'
      | 'iptv-org-dach'
      | 'iptv-org-at'
      | 'iptv-org-ch' = 'basis'
  ) => {
    if (preset === 'fast') {
      setName('DE Sport, Doku & Film Online-Feed');
      setUrl('/api/feeds/de-fast-live.m3u');
      const existingOnline = playlists.find((p) => p.id === 'pl-online-live-de');
      if (existingOnline) {
        setPlaylistMode('existing');
        setTargetPlaylistId(existingOnline.id);
      } else {
        setPlaylistMode('new');
        setNewPlaylistName('Live-TV & Free-Streams Online (DE)');
      }
      setIntervalMinutes(10);
    } else if (preset === 'iptv-org-dach') {
      setName('IPTV-org DACH Live-Import (DE / AT / CH)');
      setUrl('/api/feeds/iptv-org-dach.m3u');
      const existingDach = playlists.find((p) => p.id === 'pl-iptv-org-dach');
      if (existingDach) {
        setPlaylistMode('existing');
        setTargetPlaylistId(existingDach.id);
      } else {
        setPlaylistMode('new');
        setNewPlaylistName('IPTV-org DACH Live-TV');
      }
      setIntervalMinutes(30);
    } else if (preset === 'iptv-org-de') {
      setName('IPTV-org Deutschland (Live GitHub M3U)');
      setUrl('https://iptv-org.github.io/iptv/countries/de.m3u');
      setPlaylistMode('new');
      setNewPlaylistName('IPTV-org Deutschland Live');
      setIntervalMinutes(30);
    } else if (preset === 'iptv-org-at') {
      setName('IPTV-org Österreich (AT M3U)');
      setUrl('https://iptv-org.github.io/iptv/countries/at.m3u');
      setPlaylistMode('new');
      setNewPlaylistName('IPTV-org Österreich Live');
      setIntervalMinutes(30);
    } else if (preset === 'iptv-org-ch') {
      setName('IPTV-org Schweiz (CH M3U)');
      setUrl('https://iptv-org.github.io/iptv/countries/ch.m3u');
      setPlaylistMode('new');
      setNewPlaylistName('IPTV-org Schweiz Live');
      setIntervalMinutes(30);
    } else {
      setName('DE Live-TV Online-Feed (ARD/ZDF/Private)');
      setUrl('/api/feeds/de-live-quellen.m3u');
      const existingAuto = playlists.find((p) => p.id === 'pl-auto-quellen');
      if (existingAuto) {
        setPlaylistMode('existing');
        setTargetPlaylistId(existingAuto.id);
      } else {
        setPlaylistMode('new');
        setNewPlaylistName('Auto-Quellen Liste (DE)');
      }
      setIntervalMinutes(5);
    }
    setAutoRefresh(true);
    setFormError(null);
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    const portNum = Number(startPort);

    if (!trimmedName) {
      setFormError('Bitte einen Namen für die Quelle eingeben.');
      return;
    }
    if (!isValidSourceUrl(trimmedUrl)) {
      setFormError(
        'Bitte eine gültige http(s):// M3U-URL oder den Basis-Feed angeben.'
      );
      return;
    }
    if (!isValidIPv4(defaultIp)) {
      setFormError('Bitte eine gültige Fallback-IPv4-Adresse angeben.');
      return;
    }
    if (!isValidPort(portNum)) {
      setFormError('Start-Port muss zwischen 1 und 65535 liegen.');
      return;
    }

    const chosenExistingId =
      playlistMode === 'existing'
        ? targetPlaylistId || playlists[0]?.id
        : undefined;
    const chosenExistingPl = playlists.find((p) => p.id === chosenExistingId);

    setCreating(true);
    try {
      await onCreateSource({
        name: trimmedName,
        url: trimmedUrl,
        targetPlaylistId: chosenExistingId,
        targetPlaylistName:
          playlistMode === 'existing'
            ? chosenExistingPl?.name
            : newPlaylistName.trim() || `Auto-Liste: ${trimmedName}`,
        autoRefresh,
        intervalMinutes,
        defaultIp: defaultIp.trim(),
        startPort: portNum,
      });
      setName('');
      setUrl('');
      setNewPlaylistName('');
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Quelle konnte nicht gespeichert werden.'
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Compact KPI Strip */}
      <section
        aria-label="Status der automatischen Quellenaktualisierung"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Konfigurierte Quellen
          </div>
          <div className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {sources.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {activeAutoCount} im Auto-Sync aktiv
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Auto-Kanäle im Katalog
          </div>
          <div className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {autoDiscoveredChannelsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Automatisch ergänzt &amp; mit IP verknüpft
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Letzter Quellen-Abgleich
          </div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
            {formatDateTime(latestSyncIso)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Prüfung alle 30 Sekunden im Hintergrund
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-2">
          <div className="text-xs font-medium text-slate-500">
            Sofort-Abgleich
          </div>
          <button
            type="button"
            disabled={syncingAll || sources.length === 0}
            onClick={onSyncAllSources}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {syncingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {syncingAll ? 'Aktualisiert...' : 'Alle aktualisieren'}
            </span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Add New Auto-Sync Source */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="space-y-2.5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Automatische M3U-Quelle anbinden
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                StreamGrid prüft angebundene Quellen zyklisch, fügt neue Online-Sender mit freien IP-Endpunkten hinzu und trägt sie automatisch in deine Zielliste ein.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500 mr-1">
                Vorlagen:
              </span>
              <button
                type="button"
                onClick={() => handleApplyPreset('basis')}
                className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap"
              >
                DE Live-TV Basis
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('fast')}
                className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap"
              >
                Sport, Doku &amp; Film
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('iptv-org-dach')}
                className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
              >
                IPTV-org DACH
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('iptv-org-de')}
                className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
              >
                IPTV-org DE
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('iptv-org-at')}
                className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
              >
                AT (Österreich)
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('iptv-org-ch')}
                className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
              >
                CH (Schweiz)
              </button>
            </div>
          </div>

          {formError && (
            <div
              role="alert"
              className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateSubmit} className="space-y-3.5">
            <div>
              <label
                htmlFor="src-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Quellen-Bezeichnung
              </label>
              <input
                id="src-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Deutsche Sender M3U Feed"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="src-url"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                M3U / M3U8 Quell-URL
              </label>
              <input
                id="src-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://anbieter.de/senderliste.m3u"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="src-pl-mode"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Kanäle automatisch eintragen in
                </label>
                <select
                  id="src-pl-mode"
                  value={playlistMode}
                  onChange={(e) =>
                    setPlaylistMode(e.target.value as 'existing' | 'new')
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="new">Neue Zielliste anlegen</option>
                  {playlists.length > 0 && (
                    <option value="existing">Bestehende Playlist</option>
                  )}
                </select>
              </div>

              {playlistMode === 'new' ? (
                <div>
                  <label
                    htmlFor="src-new-pl"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Name der Zielliste
                  </label>
                  <input
                    id="src-new-pl"
                    type="text"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder="Auto-Liste (optional)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="src-existing-pl"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Zielliste auswählen
                  </label>
                  <select
                    id="src-existing-pl"
                    value={targetPlaylistId || playlists[0]?.id || ''}
                    onChange={(e) => setTargetPlaylistId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {playlists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="src-interval"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Aktualisierung
                </label>
                <select
                  id="src-interval"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="src-def-ip"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Fallback-IPv4
                </label>
                <input
                  id="src-def-ip"
                  type="text"
                  value={defaultIp}
                  onChange={(e) => setDefaultIp(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="src-port"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Start-Port
                </label>
                <input
                  id="src-port"
                  type="number"
                  value={startPort}
                  onChange={(e) => setStartPort(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>
                Quelle immer automatisch aktualisieren und neue Kanäle direkt eintragen
              </span>
            </label>

            <button
              type="submit"
              disabled={creating}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="w-4 h-4" aria-hidden="true" />
              )}
              <span>
                {creating
                  ? 'Verknüpft & synchronisiert...'
                  : 'Quelle hinzufügen & sofort einlesen'}
              </span>
            </button>
          </form>
        </section>

        {/* Right: Configured Sources List + Sync History */}
        <div className="xl:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Aktive Stream-Quellen ({sources.length})
              </h2>
              <span className="text-xs text-slate-500">
                Automatische Erkennung &amp; Listeneintrag
              </span>
            </div>

            {sources.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-600">
                  Noch keine M3U-Quelle hinterlegt. Verknüpfe links deine erste Quelle oder nutze den deutschen Basis-Feed.
                </p>
                <button
                  type="button"
                  onClick={() => handleApplyPreset('basis')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>DE Basis-Feed vorausfüllen</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {sources.map((src) => {
                  const isSyncing = syncingIds.includes(src.id) || syncingAll;
                  const targetPl = playlists.find(
                    (p) => p.id === src.targetPlaylistId
                  );
                  return (
                    <div
                      key={src.id}
                      className="p-4 sm:px-5 space-y-3 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-slate-900">
                              {src.name}
                            </span>
                            <span className="text-xs text-slate-500 font-mono tabular-nums">
                              · alle {src.intervalMinutes} Min.
                            </span>
                          </div>
                          <div className="font-mono text-xs text-slate-600 truncate">
                            {src.url}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => onSyncSource(src.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            {isSyncing ? (
                              <Loader2
                                className="w-3.5 h-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <RefreshCw
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              />
                            )}
                            <span>Aktualisieren</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleSourceAutoRefresh(src)}
                            className={`px-2.5 py-1.5 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 ${
                              src.autoRefresh
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {src.autoRefresh ? 'Auto-Sync: An' : 'Auto-Sync: Aus'}
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteSource(src)}
                            aria-label={`Quelle "${src.name}" löschen`}
                            title="Quelle löschen"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pt-1">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="inline-flex items-center gap-1.5">
                            {src.lastStatus === 'ok' ? (
                              <CheckCircle2
                                className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                                aria-hidden="true"
                              />
                            ) : src.lastStatus === 'error' ? (
                              <AlertTriangle
                                className="w-3.5 h-3.5 text-red-600 shrink-0"
                                aria-hidden="true"
                              />
                            ) : (
                              <Clock
                                className="w-3.5 h-3.5 text-slate-400 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span className="tabular-nums">
                              {src.lastStatus === 'error'
                                ? `Fehler: ${src.lastError || 'Abruf fehlgeschlagen'}`
                                : `Letzter Abgleich: ${formatDateTime(src.lastSyncedAt)}`}
                            </span>
                          </span>

                          {typeof src.lastTotalCount === 'number' && (
                            <span className="font-mono text-slate-700 tabular-nums">
                              {src.lastTotalCount} erkannt · +{src.lastAddedCount ?? 0} neu ·{' '}
                              {src.lastUpdatedCount ?? 0} aktualisiert
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleSourceEnabled(src)}
                            className="text-xs text-slate-500 hover:text-slate-900 underline"
                          >
                            {src.enabled ? 'Deaktivieren' : 'Aktivieren'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPlaylist(targetPl?.id || src.targetPlaylistId)
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
                          >
                            <span>
                              Liste: {targetPl?.name || src.targetPlaylistName} (
                              {targetPl?.channelIds.length ?? 0})
                            </span>
                            <ExternalLink
                              className="w-3 h-3 shrink-0"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Auto-Sync Event Log */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Verlauf der automatischen Listeneinträge
              </h2>
              <span className="text-xs text-slate-500 tabular-nums">
                {syncLogs.length} Ereignisse
              </span>
            </div>

            {syncLogs.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                Sobald eine Quelle synchronisiert wird, erscheinen hier alle neu hinzugefügten Kanäle und eingetragenen Playlists.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
                {syncLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-5 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {log.status === 'ok' ? (
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <AlertTriangle
                          className="w-3.5 h-3.5 text-red-600 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-medium text-slate-900 truncate">
                        {log.sourceName}
                      </span>
                      <span className="text-slate-500 truncate">
                        → {log.playlistName}
                      </span>
                    </div>
                    <div className="font-mono text-slate-600 tabular-nums shrink-0">
                      {log.status === 'ok'
                        ? `+${log.addedCount} neu · ${log.linkedCount} in Liste · ${formatDateTime(log.syncedAt)}`
                        : `Fehler · ${formatDateTime(log.syncedAt)}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
