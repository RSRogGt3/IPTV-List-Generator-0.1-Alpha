import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, Plus, Trash2 } from 'lucide-react';
import {
  buildStreamUrl,
  generateIpAssignments,
  isValidIPv4,
  isValidPort,
} from '../lib/ipUtils';
import {
  Channel,
  ConflictItem,
  IpGenerationConfig,
  IpGenerationMode,
  IpProfile,
  PROVIDER_META,
  ProviderId,
  StreamProtocol,
} from '../lib/types';

interface IpGeneratorViewProps {
  channels: Channel[];
  ipProfiles: IpProfile[];
  conflicts: ConflictItem[];
  preselectedChannelIds: string[];
  onClearPreselection: () => void;
  onApplyBulkIp: (channelIds: string[], config: IpGenerationConfig) => Promise<void>;
  onCreateProfile: (payload: Omit<IpProfile, 'id'>) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
}

export function IpGeneratorView({
  channels,
  ipProfiles,
  conflicts,
  preselectedChannelIds,
  onClearPreselection,
  onApplyBulkIp,
  onCreateProfile,
  onDeleteProfile,
}: IpGeneratorViewProps) {
  const [scope, setScope] = useState<'all' | 'provider' | 'selected'>(
    preselectedChannelIds.length > 0 ? 'selected' : 'provider'
  );
  const [targetProvider, setTargetProvider] = useState<ProviderId>('sky');
  const [baseIp, setBaseIp] = useState('192.168.178.50');
  const [startPort, setStartPort] = useState('8001');
  const [protocol, setProtocol] = useState<StreamProtocol>('http');
  const [mode, setMode] = useState<IpGenerationMode>('increment-port');
  const [pathPrefix, setPathPrefix] = useState('/live');
  const [includeSlug, setIncludeSlug] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [applying, setApplying] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedChannelIds.length > 0) {
      setScope('selected');
    }
  }, [preselectedChannelIds]);

  const targetChannels = useMemo(() => {
    if (scope === 'selected' && preselectedChannelIds.length > 0) {
      const set = new Set(preselectedChannelIds);
      return channels.filter((c) => set.has(c.id));
    }
    if (scope === 'provider') {
      return channels.filter((c) => c.provider === targetProvider);
    }
    return channels;
  }, [scope, preselectedChannelIds, channels, targetProvider]);

  const previewResult = useMemo(() => {
    const portNum = Number(startPort);
    if (!isValidIPv4(baseIp) || !isValidPort(portNum)) {
      return { valid: false as const, error: 'Bitte gültige Basis-IPv4 und Port (1–65535) eingeben.', items: [] };
    }
    try {
      const assigned = generateIpAssignments(targetChannels, {
        baseIp,
        startPort: portNum,
        protocol,
        mode,
        pathPrefix,
        includeChannelSlugInPath: includeSlug,
      });
      return { valid: true as const, error: null, items: assigned };
    } catch (err) {
      return {
        valid: false as const,
        error: err instanceof Error ? err.message : 'Konfigurationsfehler.',
        items: [],
      };
    }
  }, [targetChannels, baseIp, startPort, protocol, mode, pathPrefix, includeSlug]);

  const applyProfileTemplate = (prof: IpProfile) => {
    setBaseIp(prof.baseIp);
    setStartPort(String(prof.startPort));
    setProtocol(prof.protocol);
    setMode(prof.mode);
    setPathPrefix(prof.pathPrefix);
    setError(null);
  };

  const handleApply = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!previewResult.valid) {
      setError(previewResult.error);
      return;
    }
    if (targetChannels.length === 0) {
      setError('Keine Zielkanäle für die IP-Zuweisung gefunden.');
      return;
    }
    setApplying(true);
    try {
      await onApplyBulkIp(
        targetChannels.map((c) => c.id),
        {
          baseIp: baseIp.trim(),
          startPort: Number(startPort),
          protocol,
          mode,
          pathPrefix,
          includeChannelSlugInPath: includeSlug,
        }
      );
      if (scope === 'selected') {
        onClearPreselection();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zuweisung fehlgeschlagen.');
    } finally {
      setApplying(false);
    }
  };

  const handleSaveAsProfile = async () => {
    setError(null);
    if (!profileName.trim()) {
      setError('Bitte einen Namen für das IP-Profil eingeben.');
      return;
    }
    if (!isValidIPv4(baseIp) || !isValidPort(Number(startPort))) {
      setError('Ungültige Basis-IP oder Start-Port.');
      return;
    }
    setSavingProfile(true);
    try {
      await onCreateProfile({
        name: profileName.trim(),
        description: `${protocol.toUpperCase()} · Basis ${baseIp}:${startPort} · ${mode}`,
        baseIp: baseIp.trim(),
        startPort: Number(startPort),
        protocol,
        mode,
        pathPrefix,
      });
      setProfileName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profil konnte nicht gespeichert werden.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Saved IP Profiles Strip */}
      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold text-slate-900">
          Gespeicherte IP-Netzwerkprofile
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ipProfiles.map((prof) => (
            <div
              key={prof.id}
              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm text-slate-900">
                    {prof.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteProfile(prof.id)}
                    aria-label={`Profil "${prof.name}" löschen`}
                    className="text-slate-400 hover:text-red-600 p-1 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">{prof.description}</p>
                <div className="mt-2 font-mono text-xs text-slate-700 tabular-nums">
                  {prof.protocol.toUpperCase()} · {prof.baseIp}:{prof.startPort}
                </div>
              </div>

              <button
                type="button"
                onClick={() => applyProfileTemplate(prof)}
                className="w-full py-1.5 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
              >
                Vorlage laden
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Generator Config Form */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="font-display text-base font-semibold text-slate-900">
            IP-Adressen automatisch erstellen & zuweisen
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Erzeugt eindeutige IPv4-Adressen, Ports und Stream-Pfade für Sky, Netflix, Amazon Prime, Disney+ oder alle deutschen Kanäle.
          </p>

          <form onSubmit={handleApply} className="mt-5 space-y-4">
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
                htmlFor="gen-scope"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Zielbereich
              </label>
              <select
                id="gen-scope"
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as 'all' | 'provider' | 'selected')
                }
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="provider">Nach Anbieter / Plattform filtern</option>
                <option value="all">Alle Kanäle ({channels.length})</option>
                {preselectedChannelIds.length > 0 && (
                  <option value="selected">
                    Ausgewählte Kanäle ({preselectedChannelIds.length})
                  </option>
                )}
              </select>
            </div>

            {scope === 'provider' && (
              <div>
                <label
                  htmlFor="gen-provider"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Anbieter auswählen
                </label>
                <select
                  id="gen-provider"
                  value={targetProvider}
                  onChange={(e) => setTargetProvider(e.target.value as ProviderId)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {(Object.keys(PROVIDER_META) as ProviderId[]).map((pid) => (
                    <option key={pid} value={pid}>
                      {PROVIDER_META[pid].label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="gen-mode"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Vergabemodus
              </label>
              <select
                id="gen-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as IpGenerationMode)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="increment-port">
                  Feste IP + fortlaufender Port (z. B. :8001, :8002...)
                </option>
                <option value="increment-ip">
                  Fortlaufende IP + fester Port (z. B. .50, .51, .52...)
                </option>
                <option value="provider-blocks">
                  Feste Subnetz-Blöcke je Anbieter (Sky .10, Netflix .30, Prime .50, Disney+ .70)
                </option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-6">
                <label
                  htmlFor="gen-base-ip"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Basis-IPv4
                </label>
                <input
                  id="gen-base-ip"
                  type="text"
                  value={baseIp}
                  onChange={(e) => setBaseIp(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="gen-port"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Start-Port
                </label>
                <input
                  id="gen-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={startPort}
                  onChange={(e) => setStartPort(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-3">
                <label
                  htmlFor="gen-proto"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Protokoll
                </label>
                <select
                  id="gen-proto"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as StreamProtocol)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="rtsp">RTSP</option>
                  <option value="udp">UDP</option>
                  <option value="rtp">RTP</option>
                </select>
              </div>
            </div>

            {protocol !== 'udp' && protocol !== 'rtp' && (
              <div className="space-y-2">
                <div>
                  <label
                    htmlFor="gen-prefix"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Pfad-Präfix
                  </label>
                  <input
                    id="gen-prefix"
                    type="text"
                    value={pathPrefix}
                    onChange={(e) => setPathPrefix(e.target.value)}
                    placeholder="/live"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSlug}
                    onChange={(e) => setIncludeSlug(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Kanal-Slug an Pfad anhängen (z. B. /live/sky-sport-f1-hd)</span>
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={applying || !previewResult.valid || targetChannels.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Play className="w-4 h-4" aria-hidden="true" />
              <span>
                {applying
                  ? 'Wendet IPs an...'
                  : `IPs für ${targetChannels.length} Kanäle generieren & speichern`}
              </span>
            </button>
          </form>

          {/* Save current schema as profile */}
          <div className="mt-5 pt-4 border-t border-slate-200 space-y-2">
            <label
              htmlFor="new-prof-name"
              className="block text-xs font-semibold text-slate-700"
            >
              Aktuelles Schema als Profil sichern
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-prof-name"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="z. B. Gäste-WLAN Subnetz"
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                disabled={savingProfile}
                onClick={handleSaveAsProfile}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Profil sichern</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Live Dry-Run Preview & Conflict Audit */}
        <div className="xl:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Vorschau der neuen IP-Endpunkte ({targetChannels.length})
              </h2>
              <span className="text-xs text-slate-500">
                Live-Berechnung vor dem Speichern
              </span>
            </div>

            {!previewResult.valid ? (
              <div className="p-6 text-sm text-red-600">
                {previewResult.error}
              </div>
            ) : previewResult.items.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Keine Kanäle im gewählten Zielbereich.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full table-fixed text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="w-[24%] py-2.5 pl-4 pr-2">Kanal</th>
                      <th className="w-[38%] py-2.5 px-2">Aktuelle IP-URL</th>
                      <th className="w-[38%] py-2.5 pl-2 pr-4">Neue IP-URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {previewResult.items.map((nextCh, idx) => {
                      const prevCh = targetChannels[idx];
                      return (
                        <tr key={nextCh.id} className="hover:bg-slate-50/70 align-top">
                          <td className="py-2.5 pl-4 pr-2 font-medium text-slate-900 break-words">
                            {nextCh.name}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-[11px] text-slate-400 tabular-nums break-all">
                            {buildStreamUrl(prevCh)}
                          </td>
                          <td className="py-2.5 pl-2 pr-4 font-mono text-[11px] text-blue-700 font-medium tabular-nums break-all">
                            {buildStreamUrl(nextCh)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Conflict Audit */}
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Endpunkt-Konfliktprüfung
              </h2>
              {conflicts.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>Keine Konflikte erkannt</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  <span>{conflicts.length} Kollision(en)</span>
                </span>
              )}
            </div>

            {conflicts.length > 0 && (
              <div className="mt-3 divide-y divide-slate-200 border border-red-200 rounded-md bg-red-50/40">
                {conflicts.map((conf) => (
                  <div key={conf.endpointKey} className="p-3 text-xs">
                    <div className="font-mono font-semibold text-red-700 tabular-nums">
                      {conf.endpointKey}
                    </div>
                    <div className="mt-1 text-slate-700">
                      Belegt durch:{' '}
                      {conf.channels.map((c) => c.name).join(' · ')}
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
