import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  buildStreamUrl,
  isValidIPv4,
  isValidPort,
  isValidUpstreamUrl,
  slugifyChannelName,
} from '../lib/ipUtils';
import {
  Channel,
  ChannelQuality,
  PROVIDER_META,
  Playlist,
  ProviderId,
  StreamProtocol,
} from '../lib/types';

interface ChannelModalProps {
  open: boolean;
  editingChannel: Channel | null;
  playlists: Playlist[];
  onClose: () => void;
  onSubmit: (
    payload: Omit<Channel, 'id' | 'updatedAt'> & { playlistIds: string[] },
    existingId?: string
  ) => Promise<void>;
}

const QUALITIES: ChannelQuality[] = ['4K UHD', 'Full HD', 'HD', 'SD'];
const PROTOCOLS: StreamProtocol[] = ['http', 'https', 'rtsp', 'udp', 'rtp'];

export function ChannelModal({
  open,
  editingChannel,
  playlists,
  onClose,
  onSubmit,
}: ChannelModalProps) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ProviderId>('sky');
  const [category, setCategory] = useState('Sport & Live');
  const [language, setLanguage] = useState('Deutsch (DE)');
  const [quality, setQuality] = useState<ChannelQuality>('Full HD');
  const [protocol, setProtocol] = useState<StreamProtocol>('http');
  const [ip, setIp] = useState('192.168.178.50');
  const [port, setPort] = useState('8080');
  const [path, setPath] = useState('/live/neuer-kanal');
  const [tvgId, setTvgId] = useState('');
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingChannel) {
      setName(editingChannel.name);
      setProvider(editingChannel.provider);
      setCategory(editingChannel.category);
      setLanguage(editingChannel.language);
      setQuality(editingChannel.quality);
      setProtocol(editingChannel.protocol);
      setIp(editingChannel.ip);
      setPort(String(editingChannel.port));
      setPath(editingChannel.path);
      setTvgId(editingChannel.tvgId);
      setUpstreamUrl(editingChannel.upstreamUrl ?? '');
      setNotes(editingChannel.notes ?? '');
      setEnabled(editingChannel.enabled);
      setSelectedPlaylists(
        playlists
          .filter((pl) => pl.channelIds.includes(editingChannel.id))
          .map((pl) => pl.id)
      );
    } else {
      setName('');
      setProvider('sky');
      setCategory('Unterhaltung');
      setLanguage('Deutsch (DE)');
      setQuality('Full HD');
      setProtocol('http');
      setIp('192.168.178.50');
      setPort('8090');
      setPath('/live/neuer-kanal');
      setTvgId('');
      setUpstreamUrl('');
      setNotes('');
      setEnabled(true);
      setSelectedPlaylists(playlists[0] ? [playlists[0].id] : []);
    }
  }, [open, editingChannel, playlists]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const parsedPort = Number(port);
  const previewUrl =
    isValidIPv4(ip) && isValidPort(parsedPort)
      ? buildStreamUrl({ protocol, ip, port: parsedPort, path })
      : 'Ungültige IP oder Port';

  const handleTogglePlaylist = (plId: string) => {
    setSelectedPlaylists((prev) =>
      prev.includes(plId) ? prev.filter((id) => id !== plId) : [...prev, plId]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Bitte einen Kanalnamen angeben.');
      return;
    }
    if (!isValidIPv4(ip)) {
      setError('Bitte eine gültige IPv4-Adresse eingeben (z. B. 192.168.178.50).');
      return;
    }
    if (!isValidPort(parsedPort)) {
      setError('Der Port muss eine ganze Zahl zwischen 1 und 65535 sein.');
      return;
    }
    const trimmedUpstream = upstreamUrl.trim();
    if (trimmedUpstream && !isValidUpstreamUrl(trimmedUpstream)) {
      setError('Die externe Stream-URL muss mit http:// oder https:// beginnen.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          provider,
          category: category.trim() || 'Allgemein',
          language: language.trim() || 'Deutsch (DE)',
          quality,
          protocol,
          ip: ip.trim(),
          port: parsedPort,
          path: path.trim(),
          tvgId: tvgId.trim() || slugifyChannelName(name),
          enabled,
          upstreamUrl: trimmedUpstream || undefined,
          notes: notes.trim() || undefined,
          playlistIds: selectedPlaylists,
        },
        editingChannel?.id
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2
            id="channel-modal-title"
            className="font-display text-lg font-semibold text-slate-900"
          >
            {editingChannel
              ? `IP & Kanal bearbeiten: ${editingChannel.name}`
              : 'Neuen Kanal mit IP anlegen'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-5">
          {error && (
            <div
              role="alert"
              className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="ch-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Kanalname
              </label>
              <input
                id="ch-name"
                type="text"
                required
                value={name}
                onChange={(e) => {
                  const val = e.target.value;
                  setName(val);
                  if (!editingChannel) {
                    setPath(`/live/${slugifyChannelName(val)}`);
                  }
                }}
                placeholder="z. B. Sky Sport Bundesliga 1 HD"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="ch-provider"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Anbieter / Plattform
              </label>
              <select
                id="ch-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {(Object.keys(PROVIDER_META) as ProviderId[]).map((pid) => (
                  <option key={pid} value={pid}>
                    {PROVIDER_META[pid].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="ch-category"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Kategorie / Gruppe (M3U group-title)
              </label>
              <input
                id="ch-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="z. B. Sport & Live"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="ch-quality"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Auflösung
              </label>
              <select
                id="ch-quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as ChannelQuality)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="ch-language"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Sprache
              </label>
              <input
                id="ch-language"
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="text-xs font-semibold text-slate-700">
              IP-Adresse & Stream-Endpunkt
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-3">
                <label
                  htmlFor="ch-protocol"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Protokoll
                </label>
                <select
                  id="ch-protocol"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as StreamProtocol)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-6">
                <label
                  htmlFor="ch-ip"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  IPv4-Adresse
                </label>
                <input
                  id="ch-ip"
                  type="text"
                  required
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.178.50"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="ch-port"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Port
                </label>
                <input
                  id="ch-port"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {protocol !== 'udp' && protocol !== 'rtp' && (
                <div className="sm:col-span-8">
                  <label
                    htmlFor="ch-path"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    Stream-Pfad
                  </label>
                  <input
                    id="ch-path"
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/live/sky-bundesliga-1"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <div
                className={
                  protocol !== 'udp' && protocol !== 'rtp'
                    ? 'sm:col-span-4'
                    : 'sm:col-span-12'
                }
              >
                <label
                  htmlFor="ch-tvgid"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  EPG / TVG-ID
                </label>
                <input
                  id="ch-tvgid"
                  type="text"
                  value={tvgId}
                  onChange={(e) => setTvgId(e.target.value)}
                  placeholder="auto"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-500 shrink-0">
                Lokale IP-URL
              </span>
              <code className="font-mono text-xs text-slate-900 truncate">
                {previewUrl}
              </code>
            </div>

            <div>
              <label
                htmlFor="ch-upstream-url"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Externe Stream-URL / Quelle (optional, z. B. HLS .m3u8 oder HTTP-Stream)
              </label>
              <input
                id="ch-upstream-url"
                type="url"
                value={upstreamUrl}
                onChange={(e) => setUpstreamUrl(e.target.value)}
                placeholder="https://stream-quelle.beispiel.de/live/sender.m3u8"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <p className="mt-1 text-xs text-slate-500">
                Wenn hinterlegt, nutzen M3U-Playlists im Modus „Auto“ oder „Upstream“ diese externe Quelle (oder das CORS-Relay).
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-700">
              Mit Playlists verknüpfen
            </div>
            {playlists.length === 0 ? (
              <p className="text-xs text-slate-500">
                Noch keine Playlists vorhanden. Du kannst zuerst eine Playlist anlegen.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {playlists.map((pl) => {
                  const checked = selectedPlaylists.includes(pl.id);
                  return (
                    <label
                      key={pl.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm cursor-pointer transition-colors ${
                        checked
                          ? 'bg-blue-50/70 border-blue-300 text-slate-900'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleTogglePlaylist(pl.id)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span className="truncate">{pl.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Kanal in Playlists aktivieren</span>
            </label>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? 'Speichert...'
                  : editingChannel
                    ? 'Änderungen speichern'
                    : 'Kanal erstellen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
