import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { buildStreamUrl } from '../lib/ipUtils';
import { ParsedM3UEntry, parseM3U } from '../lib/m3u';
import { CentralStore, PROVIDER_META, Playlist } from '../lib/types';

interface ImportExportViewProps {
  store: CentralStore;
  playlists: Playlist[];
  onImportEntries: (payload: {
    entries: ParsedM3UEntry[];
    targetPlaylistId?: string;
    newPlaylistName?: string;
  }) => Promise<void>;
  onRestoreJson: (store: CentralStore) => Promise<void>;
  onResetDemo: () => Promise<void>;
}

const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="sky-cinema-action" group-title="Sky Deutschland",Sky Cinema Action HD
http://192.168.178.50:8015/live/sky-cinema-action
#EXTINF:-1 tvg-id="rtl-nitro" group-title="Private DE",NITRO HD
http://192.168.178.110:8520/live/nitro-hd
#EXTINF:-1 tvg-id="disney-junior" group-title="Disney+",Disney+ Junior DE
https://192.168.178.80:8310/stream/disney-junior`;

export function ImportExportView({
  store,
  playlists,
  onImportEntries,
  onRestoreJson,
  onResetDemo,
}: ImportExportViewProps) {
  const [rawM3U, setRawM3U] = useState(SAMPLE_M3U);
  const [defaultIp, setDefaultIp] = useState('192.168.178.100');
  const [startPort, setStartPort] = useState('8600');
  const [linkMode, setLinkMode] = useState<'none' | 'existing' | 'new'>('new');
  const [targetPlaylistId, setTargetPlaylistId] = useState(playlists[0]?.id ?? '');
  const [newPlaylistName, setNewPlaylistName] = useState('Importierte Sender DE');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedEntries = useMemo(
    () =>
      parseM3U(rawM3U, {
        defaultIp,
        startPort: Number(startPort) || 8600,
      }),
    [rawM3U, defaultIp, startPort]
  );

  const handleM3UFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawM3U(reader.result);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleImportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (parsedEntries.length === 0) {
      setError('Keine gültigen Kanäle im M3U-Text erkannt.');
      return;
    }
    setImporting(true);
    try {
      await onImportEntries({
        entries: parsedEntries,
        targetPlaylistId:
          linkMode === 'existing' ? targetPlaylistId || playlists[0]?.id : undefined,
        newPlaylistName:
          linkMode === 'new' ? newPlaylistName.trim() || 'Importierte Playlist' : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen.');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadJsonBackup = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamgrid-de-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as CentralStore;
        await onRestoreJson(parsed);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'JSON-Sicherung konnte nicht geladen werden.'
        );
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* M3U Importer */}
      <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              M3U / M3U8 Playlist importieren
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Liest bestehende #EXTM3U-Listen ein, erkennt Anbieter automatisch und verknüpft sie mit IPs.
            </p>
          </div>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer shrink-0">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>.m3u Datei wählen</span>
            <input
              type="file"
              accept=".m3u,.m3u8,.txt"
              onChange={handleM3UFileUpload}
              className="sr-only"
            />
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleImportSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="m3u-raw-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              M3U-Inhalt einfügen
            </label>
            <textarea
              id="m3u-raw-input"
              rows={7}
              value={rawM3U}
              onChange={(e) => setRawM3U(e.target.value)}
              className="w-full px-3 py-2 font-mono text-xs border border-slate-200 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="imp-def-ip"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Fallback-IP (falls im Stream fehlt)
              </label>
              <input
                id="imp-def-ip"
                type="text"
                value={defaultIp}
                onChange={(e) => setDefaultIp(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="imp-start-port"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Fallback Start-Port
              </label>
              <input
                id="imp-start-port"
                type="number"
                value={startPort}
                onChange={(e) => setStartPort(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="imp-link-mode"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Playlist-Verknüpfung nach Import
              </label>
              <select
                id="imp-link-mode"
                value={linkMode}
                onChange={(e) =>
                  setLinkMode(e.target.value as 'none' | 'existing' | 'new')
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="new">Neue Playlist erstellen & verknüpfen</option>
                {playlists.length > 0 && (
                  <option value="existing">Zu bestehender Playlist hinzufügen</option>
                )}
                <option value="none">Nur in Kanalkatalog importieren</option>
              </select>
            </div>

            {linkMode === 'new' && (
              <div>
                <label
                  htmlFor="imp-new-pl"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Name der neuen Playlist
                </label>
                <input
                  id="imp-new-pl"
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {linkMode === 'existing' && playlists.length > 0 && (
              <div>
                <label
                  htmlFor="imp-existing-pl"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ziel-Playlist
                </label>
                <select
                  id="imp-existing-pl"
                  value={targetPlaylistId || playlists[0]?.id}
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

          {/* Preview parsed entries */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
              Erkannte Kanäle ({parsedEntries.length})
            </div>
            {parsedEntries.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">
                Keine Einträge erkannt.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-200">
                {parsedEntries.map((entry, idx) => (
                  <div
                    key={`${entry.name}-${idx}`}
                    className="px-3.5 py-2 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                  >
                    <div>
                      <span className="font-medium text-slate-900">
                        {entry.name}
                      </span>{' '}
                      <span className="text-slate-500">
                        · {PROVIDER_META[entry.provider].shortLabel}
                      </span>
                    </div>
                    <code className="font-mono text-slate-700 tabular-nums">
                      {buildStreamUrl(entry)}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={importing || parsedEntries.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>
              {importing
                ? 'Importiert...'
                : `${parsedEntries.length} Kanäle importieren`}
            </span>
          </button>
        </form>
      </section>

      {/* Backup & Reset */}
      <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Zentrale Sicherung & Wiederherstellung
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Exportiere alle Kanäle, IP-Zuweisungen, IP-Profile und Playlists als JSON-Datei oder stelle einen früheren Stand wieder her.
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleDownloadJsonBackup}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Zentrale Konfiguration als JSON exportieren</span>
          </button>

          <label className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer">
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>JSON-Sicherung wiederherstellen</span>
            <input
              type="file"
              accept=".json"
              onChange={handleJsonUpload}
              className="sr-only"
            />
          </label>
        </div>

        <div className="pt-4 border-t border-slate-200 space-y-2">
          <div className="text-xs font-semibold text-slate-700">
            Standard-Katalog (Sky, Netflix, Prime, Disney+, DACH / AT / CH)
          </div>
          <p className="text-xs text-slate-500">
            Setzt alle Kanäle, IPs und Playlists auf den vorinstallierten DACH-Werkskatalog zurück.
          </p>
          <button
            type="button"
            onClick={onResetDemo}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Werkskatalog wiederherstellen</span>
          </button>
        </div>
      </section>
    </div>
  );
}
