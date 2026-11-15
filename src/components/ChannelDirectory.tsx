import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Edit3,
  Link2,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { buildStreamUrl } from '../lib/ipUtils';
import {
  Channel,
  ChannelReachabilityResult,
  ConflictItem,
  PROVIDER_META,
  Playlist,
  ProviderId,
} from '../lib/types';
import {
  REACHABILITY_INTERVAL_PRESETS,
  ReachabilityTrafficLight,
  formatReachabilityIntervalLabel,
  getReachabilityLabel,
  getReachabilityTrafficLight,
} from '../lib/useEndpointReachability';

interface ChannelDirectoryProps {
  channels: Channel[];
  playlists: Playlist[];
  conflicts: ConflictItem[];
  loading: boolean;
  reachabilityById: Record<string, ChannelReachabilityResult>;
  checkingReachability: boolean;
  lastReachabilityAt: string | null;
  reachabilityIntervalMs: number;
  onChangeReachabilityInterval: (intervalMs: number) => void;
  onCheckReachabilityNow: () => void;
  onEditChannel: (channel: Channel) => void;
  onDeleteChannel: (channel: Channel) => void;
  onToggleEnabled: (channel: Channel) => void;
  onOpenBulkLinkModal: (channelIds: string[]) => void;
  onGoToIpGeneratorWithSelection: (channelIds: string[]) => void;
  onNewChannel: () => void;
  onOpenTestPlayer: (channel: Channel) => void;
}

const PROVIDER_FILTERS: { id: 'all' | ProviderId; label: string }[] = [
  { id: 'all', label: 'Alle Sender' },
  { id: 'sky', label: 'Sky' },
  { id: 'netflix', label: 'Netflix' },
  { id: 'amazon', label: 'Amazon Prime' },
  { id: 'disney', label: 'Disney+' },
  { id: 'public_de', label: 'Öffentlich-Rechtlich' },
  { id: 'private_de', label: 'Private DE' },
  { id: 'at_ch', label: 'AT & CH (DACH)' },
  { id: 'custom', label: 'Eigene' },
];

export function ChannelDirectory({
  channels,
  playlists,
  conflicts,
  loading,
  reachabilityById,
  checkingReachability,
  lastReachabilityAt,
  reachabilityIntervalMs,
  onChangeReachabilityInterval,
  onCheckReachabilityNow,
  onEditChannel,
  onDeleteChannel,
  onToggleEnabled,
  onOpenBulkLinkModal,
  onGoToIpGeneratorWithSelection,
  onNewChannel,
  onOpenTestPlayer,
}: ChannelDirectoryProps) {
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderId>('all');
  const [reachabilityFilter, setReachabilityFilter] = useState<
    'all' | Exclude<ReachabilityTrafficLight, 'pending'>
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isPresetInterval = REACHABILITY_INTERVAL_PRESETS.some(
    (p) => p.ms === reachabilityIntervalMs
  );
  const [customMode, setCustomMode] = useState(!isPresetInterval);
  const [customSecondsInput, setCustomSecondsInput] = useState(() =>
    reachabilityIntervalMs > 0
      ? String(Math.round(reachabilityIntervalMs / 1000))
      : '45'
  );

  const handleSelectIntervalChange = (value: string) => {
    if (value === 'custom') {
      setCustomMode(true);
      const parsedSec = Number(customSecondsInput);
      const nextSec =
        Number.isFinite(parsedSec) && parsedSec >= 10
          ? Math.min(3600, Math.round(parsedSec))
          : 45;
      setCustomSecondsInput(String(nextSec));
      onChangeReachabilityInterval(nextSec * 1000);
      return;
    }
    setCustomMode(false);
    const ms = Number(value);
    if (Number.isFinite(ms)) {
      onChangeReachabilityInterval(ms);
    }
  };

  const applyCustomSeconds = () => {
    const parsed = Number(customSecondsInput);
    const clamped = Number.isFinite(parsed)
      ? Math.max(10, Math.min(3600, Math.round(parsed)))
      : 45;
    setCustomSecondsInput(String(clamped));
    onChangeReachabilityInterval(clamped * 1000);
  };

  const conflictChannelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conflicts) {
      for (const ch of c.channels) ids.add(ch.id);
    }
    return ids;
  }, [conflicts]);

  const playlistsByChannelId = useMemo(() => {
    const map = new Map<string, Playlist[]>();
    for (const pl of playlists) {
      for (const cid of pl.channelIds) {
        const list = map.get(cid) ?? [];
        list.push(pl);
        map.set(cid, list);
      }
    }
    return map;
  }, [playlists]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: channels.length };
    for (const ch of channels) {
      counts[ch.provider] = (counts[ch.provider] ?? 0) + 1;
    }
    return counts;
  }, [channels]);

  const reachabilityCounts = useMemo(() => {
    const summary = { green: 0, yellow: 0, red: 0, pending: 0 };
    for (const ch of channels) {
      const light = getReachabilityTrafficLight(reachabilityById[ch.id]);
      summary[light] += 1;
    }
    return summary;
  }, [channels, reachabilityById]);

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return channels.filter((ch) => {
      if (providerFilter !== 'all' && ch.provider !== providerFilter) return false;
      if (onlyConflicts && !conflictChannelIds.has(ch.id)) return false;
      if (reachabilityFilter !== 'all') {
        const light = getReachabilityTrafficLight(reachabilityById[ch.id]);
        if (light !== reachabilityFilter) return false;
      }
      if (!q) return true;
      const url = buildStreamUrl(ch, undefined, { mode: 'auto' }).toLowerCase();
      return (
        ch.name.toLowerCase().includes(q) ||
        ch.category.toLowerCase().includes(q) ||
        ch.ip.includes(q) ||
        String(ch.port).includes(q) ||
        url.includes(q) ||
        PROVIDER_META[ch.provider].label.toLowerCase().includes(q)
      );
    });
  }, [
    channels,
    providerFilter,
    onlyConflicts,
    conflictChannelIds,
    reachabilityFilter,
    reachabilityById,
    searchQuery,
  ]);

  const allFilteredSelected =
    filteredChannels.length > 0 &&
    filteredChannels.every((c) => selectedIds.includes(c.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredChannels.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([...selectedIds, ...filteredChannels.map((c) => c.id)]);
      setSelectedIds(Array.from(merged));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCopyUrl = async (ch: Channel) => {
    const url = buildStreamUrl(ch, undefined, { mode: 'auto' });
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(ch.id);
      setTimeout(() => {
        setCopiedId((current) => (current === ch.id ? null : current));
      }, 1500);
    } catch {
      // Fallback if clipboard denied
    }
  };

  const activeCount = channels.filter((c) => c.enabled).length;
  const onlineCount = channels.filter((c) => Boolean(c.upstreamUrl)).length;

  return (
    <div className="space-y-6">
      {/* Compact Overview Strip */}
      <section
        aria-label="Bestandsübersicht"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Kanäle gesamt</div>
          <div className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {channels.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {onlineCount} online · {activeCount} aktiv
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Streaming & Pay-TV
          </div>
          <div className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {(providerCounts.sky ?? 0) +
              (providerCounts.netflix ?? 0) +
              (providerCounts.amazon ?? 0) +
              (providerCounts.disney ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Sky · Netflix · Prime · Disney+
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">
            Verknüpfte Playlists
          </div>
          <div className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {playlists.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Zentral als M3U bereitgestellt
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">IP-Konflikte</div>
          <div
            className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
              conflicts.length > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {conflicts.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {conflicts.length > 0
              ? 'Doppelte IP:Port-Endpunkte prüfen'
              : 'Alle aktiven Endpunkte eindeutig'}
          </div>
        </div>
      </section>

      {/* Filter & Search Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Provider Segmented Filter */}
          <div
            role="tablist"
            aria-label="Anbieterfilter"
            className="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0"
          >
            {PROVIDER_FILTERS.map((pf) => {
              const active = providerFilter === pf.id;
              const count = providerCounts[pf.id] ?? 0;
              return (
                <button
                  key={pf.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setProviderFilter(pf.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[36px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span>{pf.label}</span>
                  <span
                    className={`ml-1.5 font-mono tabular-nums ${
                      active ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {conflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setOnlyConflicts((v) => !v)}
                aria-pressed={onlyConflicts}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                  onlyConflicts
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Nur Konflikte ({conflicts.length})</span>
              </button>
            )}

            <div className="relative flex-1 sm:w-64">
              <label htmlFor="channel-search" className="sr-only">
                Kanäle, IPs oder Ports durchsuchen
              </label>
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="channel-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Sender, IP oder Port suchen..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent min-h-[40px]"
              />
            </div>
          </div>
        </div>

        {/* Background Endpoint Reachability Bar */}
        <div
          aria-label="Hintergrund-Erreichbarkeitsmonitor"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-slate-100"
        >
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs font-medium text-slate-500 mr-1">
              Endpunkt-Status:
            </span>
            <button
              type="button"
              onClick={() =>
                setReachabilityFilter((prev) =>
                  prev === 'green' ? 'all' : 'green'
                )
              }
              aria-pressed={reachabilityFilter === 'green'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                reachabilityFilter === 'green'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                aria-hidden="true"
              />
              <span>Erreichbar</span>
              <span className="font-mono tabular-nums text-slate-500">
                {reachabilityCounts.green}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setReachabilityFilter((prev) =>
                  prev === 'yellow' ? 'all' : 'yellow'
                )
              }
              aria-pressed={reachabilityFilter === 'yellow'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                reachabilityFilter === 'yellow'
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full bg-amber-400 border border-amber-500/50 shrink-0"
                aria-hidden="true"
              />
              <span>Lokales LAN</span>
              <span className="font-mono tabular-nums text-slate-500">
                {reachabilityCounts.yellow}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                setReachabilityFilter((prev) => (prev === 'red' ? 'all' : 'red'))
              }
              aria-pressed={reachabilityFilter === 'red'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                reachabilityFilter === 'red'
                  ? 'bg-red-50 border-red-300 text-red-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full bg-red-500 shrink-0"
                aria-hidden="true"
              />
              <span>Nicht erreichbar</span>
              <span className="font-mono tabular-nums text-slate-500">
                {reachabilityCounts.red}
              </span>
            </button>

            {reachabilityFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setReachabilityFilter('all')}
                className="text-xs text-slate-500 hover:text-slate-800 underline px-1"
              >
                Alle anzeigen
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="reachability-interval"
                className="font-medium text-slate-600 whitespace-nowrap"
              >
                Prüfintervall:
              </label>
              <select
                id="reachability-interval"
                value={
                  customMode || !isPresetInterval
                    ? 'custom'
                    : String(reachabilityIntervalMs)
                }
                onChange={(e) => handleSelectIntervalChange(e.target.value)}
                aria-label="Intervall für Hintergrund-Erreichbarkeitsprüfung"
                className="h-8 px-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {REACHABILITY_INTERVAL_PRESETS.map((preset) => (
                  <option key={preset.ms} value={String(preset.ms)}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Benutzerdefiniert…</option>
              </select>

              {(customMode || !isPresetInterval) && (
                <div className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min={10}
                    max={3600}
                    step={5}
                    value={customSecondsInput}
                    onChange={(e) => setCustomSecondsInput(e.target.value)}
                    onBlur={applyCustomSeconds}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCustomSeconds();
                    }}
                    aria-label="Benutzerdefiniertes Intervall in Sekunden (10–3600)"
                    className="w-16 h-8 px-2 text-xs font-mono tabular-nums text-slate-800 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <span className="text-slate-500">Sek.</span>
                </div>
              )}
            </div>

            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums whitespace-nowrap">
              {checkingReachability && (
                <Loader2
                  className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>
                {checkingReachability
                  ? 'Prüft…'
                  : lastReachabilityAt
                    ? `${formatReachabilityIntervalLabel(reachabilityIntervalMs)} · ${new Date(
                        lastReachabilityAt
                      ).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}`
                    : `${formatReachabilityIntervalLabel(reachabilityIntervalMs)} bereit`}
              </span>
            </span>

            <button
              type="button"
              onClick={onCheckReachabilityNow}
              disabled={checkingReachability || channels.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 ${
                  checkingReachability ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
              <span>Jetzt prüfen</span>
            </button>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            <div className="text-sm font-medium text-slate-900 tabular-nums">
              {selectedIds.length}{' '}
              {selectedIds.length === 1 ? 'Kanal ausgewählt' : 'Kanäle ausgewählt'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenBulkLinkModal(selectedIds)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
              >
                <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Mit Playlist verknüpfen</span>
              </button>
              <button
                type="button"
                onClick={() => onGoToIpGeneratorWithSelection(selectedIds)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
              >
                <Network className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>IPs per Generator zuweisen</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap"
              >
                Auswahl aufheben
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Channel Data Grid */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3" aria-label="Kanäle werden geladen">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-11 bg-slate-100 rounded animate-pulse"
              />
            ))}
          </div>
        ) : filteredChannels.length === 0 ? (
          <div className="p-12 text-center">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Keine passenden Kanäle gefunden
            </h2>
            <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
              Passe deine Suche oder den Anbieterfilter an, oder lege einen neuen deutschen Kanal mit eigener IP-Adresse an.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              {(searchQuery ||
                providerFilter !== 'all' ||
                reachabilityFilter !== 'all' ||
                onlyConflicts) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setProviderFilter('all');
                    setReachabilityFilter('all');
                    setOnlyConflicts(false);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                >
                  Filter zurücksetzen
                </button>
              )}
              <button
                type="button"
                onClick={onNewChannel}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Ersten Kanal anlegen</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                  <th className="py-3 pl-4 pr-2 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="Alle sichtbaren Kanäle auswählen"
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                  </th>
                  <th className="py-3 px-3">Kanal & Anbieter</th>
                  <th className="py-3 px-3">IP-Endpunkt & Stream-URL</th>
                  <th className="py-3 px-3">Playlists</th>
                  <th className="py-3 px-3">Status &amp; Endpunkt</th>
                  <th className="py-3 pl-3 pr-4 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredChannels.map((ch) => {
                  const isSelected = selectedIds.includes(ch.id);
                  const hasConflict = conflictChannelIds.has(ch.id);
                  const linkedPlaylists = playlistsByChannelId.get(ch.id) ?? [];
                  const streamUrl = buildStreamUrl(ch, undefined, { mode: 'auto' });
                  const reachability = reachabilityById[ch.id];
                  const light = getReachabilityTrafficLight(reachability);
                  const reachabilityLabel = getReachabilityLabel(
                    reachability,
                    checkingReachability
                  );
                  const dotClass =
                    light === 'green'
                      ? 'bg-emerald-500'
                      : light === 'yellow'
                        ? 'bg-amber-400 border border-amber-500/60'
                        : light === 'red'
                          ? 'bg-red-500'
                          : checkingReachability
                            ? 'bg-amber-400 border border-amber-500/60'
                            : 'bg-slate-300';
                  const labelClass =
                    light === 'green'
                      ? 'text-emerald-700'
                      : light === 'yellow'
                        ? 'text-amber-700'
                        : light === 'red'
                          ? 'text-red-700'
                          : 'text-slate-500';

                  return (
                    <tr
                      key={ch.id}
                      className={`transition-colors hover:bg-slate-50/90 ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="py-3 pl-4 pr-2 align-middle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(ch.id)}
                          aria-label={`Kanal "${ch.name}" auswählen`}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                        />
                      </td>

                      <td className="py-3 px-3 align-middle min-w-[165px]">
                        <div className="font-medium text-slate-900">
                          {ch.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                          <span>{PROVIDER_META[ch.provider].shortLabel}</span>
                          <span aria-hidden="true">·</span>
                          <span>{ch.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{ch.quality}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 align-middle min-w-[205px]">
                        <div className="flex items-center gap-1.5">
                          <code
                            title={streamUrl}
                            className="font-mono text-xs text-slate-800 bg-slate-100 px-2 py-1 rounded border border-slate-200/80 tabular-nums whitespace-nowrap truncate max-w-[225px]"
                          >
                            {streamUrl}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyUrl(ch)}
                            aria-label={`Stream-URL kopieren für ${ch.name}`}
                            title="Stream-URL kopieren"
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                          >
                            {copiedId === ch.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          IP {ch.ip} · Port {ch.port} · {ch.protocol.toUpperCase()}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-middle min-w-[135px] max-w-[205px]">
                        {linkedPlaylists.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => onOpenBulkLinkModal([ch.id])}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
                          >
                            + Playlist verknüpfen
                          </button>
                        ) : (
                          <div className="text-xs text-slate-700 leading-snug">
                            {linkedPlaylists.map((p) => p.name).join(' · ')}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 align-middle whitespace-nowrap min-w-[140px]">
                        <div
                          className="flex items-center gap-2"
                          title={
                            reachability?.detail ||
                            'Hintergrund-Prüfung des IP-Endpunkts läuft regelmäßig im gewählten Prüfintervall.'
                          }
                        >
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
                            aria-hidden="true"
                          />
                          <span className={`text-xs font-medium ${labelClass}`}>
                            {reachabilityLabel}
                          </span>
                          {reachability?.latencyMs !== undefined &&
                            reachability.status === 'reachable' && (
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                {reachability.latencyMs} ms
                              </span>
                            )}
                          {reachability?.httpStatus !== undefined &&
                            reachability.status !== 'reachable' && (
                              <span className="font-mono text-[11px] text-red-500 tabular-nums">
                                HTTP {reachability.httpStatus}
                              </span>
                            )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => onToggleEnabled(ch)}
                            aria-label={`Status für ${ch.name} umschalten (aktuell ${ch.enabled ? 'Aktiv' : 'Pausiert'})`}
                            className={`font-medium hover:underline ${
                              ch.enabled ? 'text-slate-600' : 'text-slate-400'
                            }`}
                          >
                            {ch.enabled ? 'Aktiv' : 'Pausiert'}
                          </button>
                          {hasConflict && ch.enabled && (
                            <span className="inline-flex items-center gap-1 font-medium text-red-600">
                              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                              <span>IP-Konflikt</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 pl-2 pr-3 align-middle text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => onOpenTestPlayer(ch)}
                            aria-label={`"${ch.name}" im Test-Player öffnen`}
                            title="Im Test-Video-Player testen"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Play className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenBulkLinkModal([ch.id])}
                            aria-label={`"${ch.name}" mit Playlist verknüpfen`}
                            title="Mit Playlist verknüpfen"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Link2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditChannel(ch)}
                            aria-label={`IP und Details bearbeiten für ${ch.name}`}
                            title="IP & Kanal bearbeiten"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteChannel(ch)}
                            aria-label={`Kanal "${ch.name}" löschen`}
                            title="Kanal löschen"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
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
    </div>
  );
}
