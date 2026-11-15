import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Playlist, StreamProtocol } from '../lib/types';

interface PlaylistModalProps {
  open: boolean;
  editingPlaylist: Playlist | null;
  onClose: () => void;
  onSubmit: (
    payload: {
      name: string;
      description: string;
      protocolOverride: StreamProtocol | 'channel';
    },
    existingId?: string
  ) => Promise<void>;
}

export function PlaylistModal({
  open,
  editingPlaylist,
  onClose,
  onSubmit,
}: PlaylistModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [protocolOverride, setProtocolOverride] = useState<
    StreamProtocol | 'channel'
  >('channel');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingPlaylist) {
      setName(editingPlaylist.name);
      setDescription(editingPlaylist.description);
      setProtocolOverride(editingPlaylist.protocolOverride ?? 'channel');
    } else {
      setName('');
      setDescription('');
      setProtocolOverride('channel');
    }
  }, [open, editingPlaylist]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Bitte einen Namen für die Playlist eingeben.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          description: description.trim(),
          protocolOverride,
        },
        editingPlaylist?.id
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
      aria-labelledby="playlist-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2
            id="playlist-modal-title"
            className="font-display text-lg font-semibold text-slate-900"
          >
            {editingPlaylist ? 'Playlist bearbeiten' : 'Neue Playlist erstellen'}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="pl-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Playlist-Name
            </label>
            <input
              id="pl-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Heimkino Mix (Sky + Netflix + DE)"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="pl-desc"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Beschreibung
            </label>
            <textarea
              id="pl-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="z. B. Für Wohnzimmer Smart-TV und VLC Player"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="pl-proto"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Ausgabe-Protokoll für M3U-Export
            </label>
            <select
              id="pl-proto"
              value={protocolOverride}
              onChange={(e) =>
                setProtocolOverride(e.target.value as StreamProtocol | 'channel')
              }
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="channel">Protokoll des jeweiligen Kanals verwenden</option>
              <option value="http">Alle Endpunkte als HTTP ausgeben</option>
              <option value="https">Alle Endpunkte als HTTPS ausgeben</option>
              <option value="rtsp">Alle Endpunkte als RTSP ausgeben</option>
              <option value="udp">Alle Endpunkte als UDP Multicast ausgeben</option>
              <option value="rtp">Alle Endpunkte als RTP ausgeben</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
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
                : editingPlaylist
                  ? 'Speichern'
                  : 'Playlist erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
