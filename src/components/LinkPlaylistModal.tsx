import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Playlist } from '../lib/types';

interface LinkPlaylistModalProps {
  open: boolean;
  channelIds: string[];
  playlists: Playlist[];
  onClose: () => void;
  onLinkToExisting: (playlistId: string, channelIds: string[]) => Promise<void>;
  onCreateAndLink: (name: string, channelIds: string[]) => Promise<void>;
}

export function LinkPlaylistModal({
  open,
  channelIds,
  playlists,
  onClose,
  onLinkToExisting,
  onCreateAndLink,
}: LinkPlaylistModalProps) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNewPlaylistName('');
    if (playlists.length > 0) {
      setMode('existing');
      setSelectedPlaylistId(playlists[0].id);
    } else {
      setMode('new');
      setSelectedPlaylistId('');
    }
  }, [open, playlists]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'existing') {
        if (!selectedPlaylistId) {
          setError('Bitte eine Playlist auswählen.');
          setSubmitting(false);
          return;
        }
        await onLinkToExisting(selectedPlaylistId, channelIds);
      } else {
        if (!newPlaylistName.trim()) {
          setError('Bitte einen Namen für die neue Playlist eingeben.');
          setSubmitting(false);
          return;
        }
        await onCreateAndLink(newPlaylistName.trim(), channelIds);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Verknüpfung fehlgeschlagen.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-playlist-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2
            id="link-playlist-title"
            className="font-display text-base font-semibold text-slate-900"
          >
            {channelIds.length === 1
              ? 'Kanal mit Playlist verknüpfen'
              : `${channelIds.length} Kanäle mit Playlist verknüpfen`}
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setMode('existing')}
              disabled={playlists.length === 0}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'existing'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 disabled:opacity-40'
              }`}
            >
              Bestehende Playlist
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'new'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Neue Playlist erstellen
            </button>
          </div>

          {mode === 'existing' ? (
            <div>
              <label
                htmlFor="link-pl-select"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ziel-Playlist auswählen
              </label>
              <select
                id="link-pl-select"
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.channelIds.length} Kanäle)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label
                htmlFor="link-pl-new"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Name der neuen Playlist
              </label>
              <input
                id="link-pl-new"
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="z. B. Heimkino Favoriten DE"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

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
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Verknüpft...' : 'Verknüpfen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
