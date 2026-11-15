import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createServer as createViteServer } from 'vite';
import { ChatTaskMode } from './src/lib/aiRouting';
import {
  formatGeminiApiError,
  runAiChatTurn,
  runLiveSearchGrounding,
  runPlaylistRecommendation,
} from './src/lib/geminiServer';
import {
  buildStreamUrl,
  detectEndpointConflicts,
  generateIpAssignments,
  isPrivateIPv4,
  isValidIPv4,
  isValidPort,
  isValidUpstreamUrl,
  normalizePath,
  slugifyChannelName,
} from './src/lib/ipUtils';
import { generateM3U, parseM3U } from './src/lib/m3u';
import {
  createInitialStore,
  upgradeStoreWithOnlineCatalog,
} from './src/lib/seedData';
import {
  isSourceDueForSync,
  isValidSourceUrl,
  mergeParsedEntriesIntoStore,
} from './src/lib/sourceSync';
import {
  CentralStore,
  Channel,
  ChannelReachabilityResult,
  IpGenerationConfig,
  IpProfile,
  M3UExportMode,
  Playlist,
  ProviderId,
  SourceSyncLogItem,
  StreamProtocol,
  StreamSource,
} from './src/lib/types';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const SYNC_CACHE_PATH = path.join(DATA_DIR, 'synced-exports.json');

interface SyncedWorkspaceSnapshot {
  channels: Channel[];
  playlists: Playlist[];
  updatedAt: string;
}

function ensureSyncedCache(): Record<string, SyncedWorkspaceSnapshot> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SYNC_CACHE_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SYNC_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, SyncedWorkspaceSnapshot>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSyncedCache(cache: Record<string, SyncedWorkspaceSnapshot>): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${SYNC_CACHE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmpPath, SYNC_CACHE_PATH);
}

function ensureStoreFile(): CentralStore {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initial = createInitialStore();
    saveStore(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CentralStore;
    if (!Array.isArray(parsed.channels) || !Array.isArray(parsed.playlists)) {
      throw new Error('Invalid store format');
    }
    const initial = createInitialStore();
    const baseStore: CentralStore = {
      channels: parsed.channels,
      playlists: parsed.playlists,
      ipProfiles: Array.isArray(parsed.ipProfiles) ? parsed.ipProfiles : [],
      streamSources: Array.isArray(parsed.streamSources)
        ? parsed.streamSources
        : initial.streamSources ?? [],
    };
    const upgraded = upgradeStoreWithOnlineCatalog(baseStore);
    if (upgraded.changed) {
      saveStore(upgraded.store);
    }
    return upgraded.store;
  } catch {
    const initial = createInitialStore();
    saveStore(initial);
    return initial;
  }
}

function saveStore(store: CentralStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

let store: CentralStore = ensureStoreFile();
const syncedWorkspaces: Record<string, SyncedWorkspaceSnapshot> = ensureSyncedCache();

function resolvePlaylistForExport(
  playlistId: string
): { playlist: Playlist; channels: Channel[] } | null {
  const candidates: Array<{
    playlist: Playlist;
    channels: Channel[];
    timestamp: number;
  }> = [];

  const localPl = store.playlists.find((p) => p.id === playlistId);
  if (localPl) {
    candidates.push({
      playlist: localPl,
      channels: store.channels,
      timestamp: Date.parse(localPl.updatedAt) || 0,
    });
  }

  for (const ws of Object.values(syncedWorkspaces)) {
    const syncedPl = ws.playlists.find((p) => p.id === playlistId);
    if (syncedPl) {
      candidates.push({
        playlist: syncedPl,
        channels: ws.channels,
        timestamp:
          Date.parse(syncedPl.updatedAt) || Date.parse(ws.updatedAt) || 0,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return {
    playlist: candidates[0].playlist,
    channels: candidates[0].channels,
  };
}

function resolveChannelById(channelId: string): Channel | null {
  for (const ws of Object.values(syncedWorkspaces)) {
    const found = ws.channels.find((c) => c.id === channelId);
    if (found) return found;
  }
  return store.channels.find((c) => c.id === channelId) ?? null;
}

function probeTcpPort(
  host: string,
  port: number,
  timeoutMs = 900
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start, error });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false, 'Timeout'));
    socket.on('error', (err) => finish(false, err.message));
  });
}

async function probeHttpEndpoint(
  url: string,
  timeoutMs = 2200
): Promise<{ ok: boolean; httpStatus?: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body?.cancel().catch(() => {});
    }
    return {
      ok: res.ok || (res.status >= 200 && res.status < 400),
      httpStatus: res.status,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: msg,
    };
  }
}

async function checkSingleChannelReachability(
  ch: Channel
): Promise<ChannelReachabilityResult> {
  const checkedAt = new Date().toISOString();

  if (ch.upstreamUrl && isValidUpstreamUrl(ch.upstreamUrl)) {
    const targetUrl = ch.upstreamUrl.trim();
    const probe = await probeHttpEndpoint(targetUrl);
    if (probe.ok) {
      return {
        channelId: ch.id,
        targetUrl,
        source: 'upstream',
        status: 'reachable',
        httpStatus: probe.httpStatus,
        latencyMs: probe.latencyMs,
        detail: `Upstream erreichbar (HTTP ${probe.httpStatus} · ${probe.latencyMs} ms)`,
        checkedAt,
      };
    }
    const isTimeout =
      probe.error?.toLowerCase().includes('timeout') ||
      probe.error?.toLowerCase().includes('aborted');
    return {
      channelId: ch.id,
      targetUrl,
      source: 'upstream',
      status: isTimeout ? 'timeout' : 'unreachable',
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      detail: probe.httpStatus
        ? `Upstream antwortet mit HTTP ${probe.httpStatus}`
        : `Upstream nicht erreichbar (${probe.error || 'Netzwerkfehler'})`,
      checkedAt,
    };
  }

  const targetUrl = buildStreamUrl(ch);
  if (!isValidIPv4(ch.ip) || !isValidPort(Number(ch.port))) {
    return {
      channelId: ch.id,
      targetUrl,
      source: 'local-ip',
      status: 'invalid',
      detail: 'Ungültige IPv4-Adresse oder Portnummer.',
      checkedAt,
    };
  }

  if (isPrivateIPv4(ch.ip)) {
    if (ch.protocol === 'udp' || ch.protocol === 'rtp') {
      return {
        channelId: ch.id,
        targetUrl,
        source: 'local-ip',
        status: 'private-lan',
        detail: `Lokaler Multicast/LAN-Stream (${ch.ip}:${ch.port}) — nur direkt im Heimnetz empfangbar.`,
        checkedAt,
      };
    }
    const tcp = await probeTcpPort(ch.ip, Number(ch.port), 700);
    if (tcp.ok) {
      return {
        channelId: ch.id,
        targetUrl,
        source: 'local-ip',
        status: 'reachable',
        latencyMs: tcp.latencyMs,
        detail: `Lokales Gateway erreichbar (${tcp.latencyMs} ms)`,
        checkedAt,
      };
    }
    return {
      channelId: ch.id,
      targetUrl,
      source: 'local-ip',
      status: 'private-lan',
      latencyMs: tcp.latencyMs,
      detail: `Lokales Heimnetz-Gateway (${ch.ip}:${ch.port}) — für Pay-TV/DRM im Heimnetz oder eigene Upstream-URL verknüpfen.`,
      checkedAt,
    };
  }

  if (ch.protocol === 'http' || ch.protocol === 'https') {
    const probe = await probeHttpEndpoint(targetUrl);
    return {
      channelId: ch.id,
      targetUrl,
      source: 'local-ip',
      status: probe.ok
        ? 'reachable'
        : probe.error?.toLowerCase().includes('timeout')
          ? 'timeout'
          : 'unreachable',
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      detail: probe.ok
        ? `Endpunkt erreichbar (HTTP ${probe.httpStatus} · ${probe.latencyMs} ms)`
        : probe.httpStatus
          ? `Endpunkt antwortet mit HTTP ${probe.httpStatus}`
          : `Nicht erreichbar (${probe.error || 'Verbindung fehlgeschlagen'})`,
      checkedAt,
    };
  }

  const tcp = await probeTcpPort(ch.ip, Number(ch.port), 1500);
  return {
    channelId: ch.id,
    targetUrl,
    source: 'local-ip',
    status: tcp.ok
      ? 'reachable'
      : tcp.error === 'Timeout'
        ? 'timeout'
        : 'unreachable',
    latencyMs: tcp.latencyMs,
    detail: tcp.ok
      ? `Port ${ch.port} erreichbar (${tcp.latencyMs} ms)`
      : `Port ${ch.port} nicht erreichbar (${tcp.error || 'Fehler'})`,
    checkedAt,
  };
}

const VALID_PROVIDERS: ProviderId[] = [
  'sky',
  'netflix',
  'amazon',
  'disney',
  'public_de',
  'private_de',
  'at_ch',
  'custom',
];

const VALID_PROTOCOLS: StreamProtocol[] = ['http', 'https', 'rtsp', 'udp', 'rtp'];

function makeId(prefix: string, name: string): string {
  const slug = slugifyChannelName(name).slice(0, 28);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${slug}-${rand}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS, HEAD'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Range'
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Type, Content-Length, Accept-Ranges, Content-Range'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config/public-url', (_req, res) => {
    const raw = process.env.APP_URL?.trim() ?? '';
    const appUrl =
      raw && raw !== 'MY_APP_URL' && raw.startsWith('http') ? raw : '';
    res.json({ appUrl });
  });

  app.get('/api/store', (_req, res) => {
    res.json(store);
  });

  app.post('/api/channels', (req, res) => {
    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
    const port = Number(body.port);
    const protocol: StreamProtocol = VALID_PROTOCOLS.includes(body.protocol)
      ? body.protocol
      : 'http';
    const provider: ProviderId = VALID_PROVIDERS.includes(body.provider)
      ? body.provider
      : 'custom';
    const category =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim()
        : 'Allgemein';
    const language =
      typeof body.language === 'string' && body.language.trim()
        ? body.language.trim()
        : 'Deutsch (DE)';
    const quality = body.quality || 'Full HD';
    const rawPath = typeof body.path === 'string' ? body.path : '';
    const rawUpstream =
      typeof body.upstreamUrl === 'string' ? body.upstreamUrl.trim() : '';
    if (rawUpstream && !isValidUpstreamUrl(rawUpstream)) {
      res.status(400).json({
        error: 'Externe Stream-URL muss mit http:// oder https:// beginnen.',
      });
      return;
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
    const enabled = body.enabled !== false;
    const playlistIds: string[] = Array.isArray(body.playlistIds)
      ? body.playlistIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];

    if (!name) {
      res.status(400).json({ error: 'Bitte einen Kanalnamen angeben.' });
      return;
    }
    if (!isValidIPv4(ip)) {
      res.status(400).json({ error: 'Ungültige IPv4-Adresse (z.B. 192.168.178.50).' });
      return;
    }
    if (!isValidPort(port)) {
      res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen.' });
      return;
    }

    const now = new Date().toISOString();
    const channel: Channel = {
      id: makeId('ch', name),
      name,
      provider,
      category,
      language,
      quality,
      protocol,
      ip,
      port,
      path: normalizePath(rawPath, protocol),
      tvgId:
        typeof body.tvgId === 'string' && body.tvgId.trim()
          ? body.tvgId.trim()
          : slugifyChannelName(name),
      enabled,
      ...(rawUpstream ? { upstreamUrl: rawUpstream } : {}),
      notes,
      updatedAt: now,
    };

    store.channels.unshift(channel);

    if (playlistIds.length > 0) {
      for (const pl of store.playlists) {
        if (
          playlistIds.includes(pl.id) &&
          !pl.channelIds.includes(channel.id) &&
          pl.channelIds.length < 200
        ) {
          pl.channelIds.push(channel.id);
          pl.updatedAt = now;
        }
      }
    }

    saveStore(store);
    res.status(201).json({ channel, store });
  });

  app.patch('/api/channels/:id', (req, res) => {
    const idx = store.channels.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Kanal nicht gefunden.' });
      return;
    }

    const existing = store.channels[idx];
    const body = req.body ?? {};
    const name =
      typeof body.name === 'string' ? body.name.trim() : existing.name;
    const ip = typeof body.ip === 'string' ? body.ip.trim() : existing.ip;
    const port = body.port !== undefined ? Number(body.port) : existing.port;
    const protocol: StreamProtocol = VALID_PROTOCOLS.includes(body.protocol)
      ? body.protocol
      : existing.protocol;

    if (!name) {
      res.status(400).json({ error: 'Kanalname darf nicht leer sein.' });
      return;
    }
    if (!isValidIPv4(ip)) {
      res.status(400).json({ error: 'Ungültige IPv4-Adresse.' });
      return;
    }
    if (!isValidPort(port)) {
      res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen.' });
      return;
    }

    const now = new Date().toISOString();
    const updated: Channel = {
      ...existing,
      name,
      provider: VALID_PROVIDERS.includes(body.provider)
        ? body.provider
        : existing.provider,
      category:
        typeof body.category === 'string' && body.category.trim()
          ? body.category.trim()
          : existing.category,
      language:
        typeof body.language === 'string' && body.language.trim()
          ? body.language.trim()
          : existing.language,
      quality: body.quality || existing.quality,
      protocol,
      ip,
      port,
      path:
        body.path !== undefined
          ? normalizePath(String(body.path), protocol)
          : normalizePath(existing.path, protocol),
      tvgId:
        typeof body.tvgId === 'string' && body.tvgId.trim()
          ? body.tvgId.trim()
          : existing.tvgId,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled,
      upstreamUrl:
        body.upstreamUrl !== undefined
          ? String(body.upstreamUrl).trim() &&
            isValidUpstreamUrl(String(body.upstreamUrl))
            ? String(body.upstreamUrl).trim()
            : undefined
          : existing.upstreamUrl,
      notes:
        body.notes !== undefined
          ? String(body.notes).trim() || undefined
          : existing.notes,
      updatedAt: now,
    };

    store.channels[idx] = updated;

    if (Array.isArray(body.playlistIds)) {
      const targetSet = new Set<string>(
        body.playlistIds.filter((id: unknown): id is string => typeof id === 'string')
      );
      for (const pl of store.playlists) {
        const hasChannel = pl.channelIds.includes(updated.id);
        if (targetSet.has(pl.id) && !hasChannel) {
          pl.channelIds.push(updated.id);
          pl.updatedAt = now;
        } else if (!targetSet.has(pl.id) && hasChannel) {
          pl.channelIds = pl.channelIds.filter((cid) => cid !== updated.id);
          pl.updatedAt = now;
        }
      }
    }

    saveStore(store);
    res.json({ channel: updated, store });
  });

  app.delete('/api/channels/:id', (req, res) => {
    const exists = store.channels.some((c) => c.id === req.params.id);
    if (!exists) {
      res.status(404).json({ error: 'Kanal nicht gefunden.' });
      return;
    }
    store.channels = store.channels.filter((c) => c.id !== req.params.id);
    const now = new Date().toISOString();
    for (const pl of store.playlists) {
      if (pl.channelIds.includes(req.params.id)) {
        pl.channelIds = pl.channelIds.filter((cid) => cid !== req.params.id);
        pl.updatedAt = now;
      }
    }
    saveStore(store);
    res.json({ store });
  });

  app.post('/api/channels/bulk-ip', (req, res) => {
    const body = req.body ?? {};
    const channelIds: string[] = Array.isArray(body.channelIds) ? body.channelIds : [];
    const config = body.config as IpGenerationConfig | undefined;

    if (!channelIds.length) {
      res.status(400).json({ error: 'Keine Kanäle für die IP-Zuweisung ausgewählt.' });
      return;
    }
    if (!config || !isValidIPv4(config.baseIp) || !isValidPort(Number(config.startPort))) {
      res.status(400).json({ error: 'Ungültige IP- oder Port-Konfiguration.' });
      return;
    }

    const idSet = new Set(channelIds);
    const orderedTargets = store.channels.filter((c) => idSet.has(c.id));

    try {
      const updatedTargets = generateIpAssignments(orderedTargets, {
        ...config,
        startPort: Number(config.startPort),
      });
      const updatedMap = new Map(updatedTargets.map((c) => [c.id, c]));
      store.channels = store.channels.map((c) => updatedMap.get(c.id) ?? c);
      saveStore(store);
      res.json({ updatedCount: updatedTargets.length, store });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Fehler bei der IP-Generierung.',
      });
    }
  });

  app.post('/api/channels/import', (req, res) => {
    const body = req.body ?? {};
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) {
      res.status(400).json({ error: 'Keine importierbaren Kanäle übergeben.' });
      return;
    }

    const now = new Date().toISOString();
    const createdChannels: Channel[] = [];

    for (const item of entries) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const ip = typeof item.ip === 'string' ? item.ip.trim() : '';
      const port = Number(item.port);
      const protocol: StreamProtocol = VALID_PROTOCOLS.includes(item.protocol)
        ? item.protocol
        : 'http';

      if (!name || !isValidIPv4(ip) || !isValidPort(port)) {
        continue;
      }

      const ch: Channel = {
        id: makeId('ch', name),
        name,
        provider: VALID_PROVIDERS.includes(item.provider) ? item.provider : 'custom',
        category:
          typeof item.category === 'string' && item.category.trim()
            ? item.category.trim()
            : 'Importiert',
        language:
          typeof item.language === 'string' && item.language.trim()
            ? item.language.trim()
            : 'Deutsch (DE)',
        quality: item.quality || 'Full HD',
        protocol,
        ip,
        port,
        path: normalizePath(typeof item.path === 'string' ? item.path : '', protocol),
        tvgId:
          typeof item.tvgId === 'string' && item.tvgId.trim()
            ? item.tvgId.trim()
            : slugifyChannelName(name),
        enabled: true,
        ...(typeof item.upstreamUrl === 'string' &&
        isValidUpstreamUrl(item.upstreamUrl)
          ? { upstreamUrl: item.upstreamUrl.trim() }
          : {}),
        updatedAt: now,
      };
      createdChannels.push(ch);
    }

    if (!createdChannels.length) {
      res.status(400).json({ error: 'Keine gültigen Kanäle in den Importdaten gefunden.' });
      return;
    }

    store.channels.unshift(...createdChannels);

    const newIds = createdChannels.map((c) => c.id);
    if (typeof body.targetPlaylistId === 'string' && body.targetPlaylistId) {
      const pl = store.playlists.find((p) => p.id === body.targetPlaylistId);
      if (pl) {
        for (const cid of newIds) {
          if (!pl.channelIds.includes(cid) && pl.channelIds.length < 200) {
            pl.channelIds.push(cid);
          }
        }
        pl.updatedAt = now;
      }
    } else if (typeof body.newPlaylistName === 'string' && body.newPlaylistName.trim()) {
      const plName = body.newPlaylistName.trim();
      const playlist: Playlist = {
        id: makeId('pl', plName),
        name: plName,
        description: `Importierte Playlist (${createdChannels.length} Kanäle)`,
        channelIds: newIds.slice(0, 200),
        protocolOverride: 'channel',
        createdAt: now,
        updatedAt: now,
      };
      store.playlists.unshift(playlist);
    }

    saveStore(store);
    res.status(201).json({ importedCount: createdChannels.length, store });
  });

  app.post('/api/playlists', (req, res) => {
    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    const channelIds: string[] = Array.isArray(body.channelIds)
      ? body.channelIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const protocolOverride =
      body.protocolOverride && (body.protocolOverride === 'channel' || VALID_PROTOCOLS.includes(body.protocolOverride))
        ? body.protocolOverride
        : 'channel';

    if (!name) {
      res.status(400).json({ error: 'Bitte einen Playlist-Namen angeben.' });
      return;
    }

    const now = new Date().toISOString();
    const playlist: Playlist = {
      id: makeId('pl', name),
      name,
      description,
      channelIds: Array.from(new Set(channelIds)).slice(0, 200),
      protocolOverride,
      createdAt: now,
      updatedAt: now,
    };

    store.playlists.unshift(playlist);
    saveStore(store);
    res.status(201).json({ playlist, store });
  });

  app.patch('/api/playlists/:id', (req, res) => {
    const idx = store.playlists.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Playlist nicht gefunden.' });
      return;
    }

    const existing = store.playlists[idx];
    const body = req.body ?? {};
    const name =
      typeof body.name === 'string' ? body.name.trim() : existing.name;
    if (!name) {
      res.status(400).json({ error: 'Playlist-Name darf nicht leer sein.' });
      return;
    }

    const updated: Playlist = {
      ...existing,
      name,
      description:
        typeof body.description === 'string'
          ? body.description.trim()
          : existing.description,
      channelIds: Array.isArray(body.channelIds)
        ? Array.from(
            new Set<string>(
              body.channelIds.filter(
                (id: unknown): id is string => typeof id === 'string'
              )
            )
          ).slice(0, 200)
        : existing.channelIds,
      protocolOverride:
        body.protocolOverride === 'channel' ||
        VALID_PROTOCOLS.includes(body.protocolOverride)
          ? body.protocolOverride
          : existing.protocolOverride,
      updatedAt: new Date().toISOString(),
    };

    store.playlists[idx] = updated;
    saveStore(store);
    res.json({ playlist: updated, store });
  });

  app.post('/api/playlists/:id/channels', (req, res) => {
    const pl = store.playlists.find((p) => p.id === req.params.id);
    if (!pl) {
      res.status(404).json({ error: 'Playlist nicht gefunden.' });
      return;
    }
    const channelIds: string[] = Array.isArray(req.body?.channelIds)
      ? req.body.channelIds
      : [];
    const validIds = new Set(store.channels.map((c) => c.id));
    let added = 0;
    for (const cid of channelIds) {
      if (validIds.has(cid) && !pl.channelIds.includes(cid)) {
        if (pl.channelIds.length >= 200) break;
        pl.channelIds.push(cid);
        added++;
      }
    }
    pl.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ added, playlist: pl, store });
  });

  app.delete('/api/playlists/:id/channels/:channelId', (req, res) => {
    const pl = store.playlists.find((p) => p.id === req.params.id);
    if (!pl) {
      res.status(404).json({ error: 'Playlist nicht gefunden.' });
      return;
    }
    pl.channelIds = pl.channelIds.filter((cid) => cid !== req.params.channelId);
    pl.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ playlist: pl, store });
  });

  app.delete('/api/playlists/:id', (req, res) => {
    const exists = store.playlists.some((p) => p.id === req.params.id);
    if (!exists) {
      res.status(404).json({ error: 'Playlist nicht gefunden.' });
      return;
    }
    store.playlists = store.playlists.filter((p) => p.id !== req.params.id);
    saveStore(store);
    res.json({ store });
  });

  const handleExportPlaylist = (
    req: express.Request,
    res: express.Response,
    ext: 'm3u' | 'm3u8'
  ) => {
    const resolved = resolvePlaylistForExport(req.params.id);
    if (!resolved) {
      res
        .status(404)
        .setHeader('Content-Type', 'text/plain; charset=utf-8')
        .send('# Playlist nicht gefunden');
      return;
    }

    const rawMode = String(req.query.mode || 'auto');
    const mode: M3UExportMode =
      rawMode === 'local' ||
      rawMode === 'upstream' ||
      rawMode === 'proxy' ||
      rawMode === 'auto'
        ? rawMode
        : 'auto';
    const playableOnly =
      req.query.playable === '1' || req.query.playable === 'true';

    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const proto = forwardedProto || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    const origin = host ? `${proto}://${host}` : '';

    const content = generateM3U(resolved.playlist, resolved.channels, {
      mode,
      origin,
      playableOnly,
    });
    const filename = `${slugifyChannelName(resolved.playlist.name)}.${ext}`;
    const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
    const contentType =
      ext === 'm3u8'
        ? 'application/vnd.apple.mpegurl; charset=utf-8'
        : 'audio/x-mpegurl; charset=utf-8';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`
    );
    res.setHeader(
      'Content-Length',
      String(Buffer.byteLength(content, 'utf-8'))
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.send(content);
  };

  app
    .route('/api/playlists/:id/export.m3u')
    .get((req, res) => handleExportPlaylist(req, res, 'm3u'))
    .head((req, res) => handleExportPlaylist(req, res, 'm3u'));

  app
    .route('/api/playlists/:id/export.m3u8')
    .get((req, res) => handleExportPlaylist(req, res, 'm3u8'))
    .head((req, res) => handleExportPlaylist(req, res, 'm3u8'));

  app.post('/api/sync/workspace', (req, res) => {
    const body = req.body ?? {};
    const uid =
      typeof body.uid === 'string' && body.uid.trim()
        ? body.uid.trim().slice(0, 128)
        : '';
    if (!uid || !Array.isArray(body.channels) || !Array.isArray(body.playlists)) {
      res.status(400).json({ error: 'Ungültige Workspace-Sync-Daten.' });
      return;
    }

    syncedWorkspaces[uid] = {
      channels: body.channels as Channel[],
      playlists: body.playlists as Playlist[],
      updatedAt: new Date().toISOString(),
    };
    saveSyncedCache(syncedWorkspaces);
    res.json({ ok: true, syncedPlaylists: body.playlists.length });
  });

  app.post('/api/channels/check-endpoints', async (req, res) => {
    const channels: Channel[] = Array.isArray(req.body?.channels)
      ? (req.body.channels as Channel[]).slice(0, 120)
      : [];
    if (channels.length === 0) {
      res.status(400).json({ error: 'Keine Kanäle zum Prüfen übergeben.' });
      return;
    }
    const results = await Promise.all(
      channels.map((ch) => checkSingleChannelReachability(ch))
    );
    res.json({ results });
  });

  const isRelaySafeUrl = (rawUrl: string): boolean => {
    if (!isValidUpstreamUrl(rawUrl)) return false;
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local') ||
        host.startsWith('169.254.') ||
        isPrivateIPv4(host)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const rewriteHlsManifest = (
    text: string,
    baseUrl: string,
    relayPrefix: string
  ): string => {
    return text
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
            try {
              const abs = new URL(uri, baseUrl).toString();
              return `URI="${relayPrefix}${encodeURIComponent(abs)}"`;
            } catch {
              return `URI="${uri}"`;
            }
          });
        }
        try {
          const abs = new URL(trimmed, baseUrl).toString();
          return `${relayPrefix}${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  };

  const proxyUpstreamStream = async (
    targetUrl: string,
    relayPrefix: string,
    req: express.Request,
    res: express.Response
  ) => {
    if (!isRelaySafeUrl(targetUrl)) {
      res.status(400).json({
        error:
          'Ungültige oder private Stream-Relay-Adresse. Nur öffentliche HTTP(S)-Quellen werden über das Server-Relay geleitet.',
      });
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'StreamGrid-DE-Relay/1.0',
      };
      const rangeHeader = req.get('range');
      if (rangeHeader) {
        headers.Range = rangeHeader;
      }

      const upstream = await fetch(targetUrl, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });

      const contentType = upstream.headers.get('content-type') || '';
      const finalUrl = upstream.url || targetUrl;
      const isHlsPlaylist =
        contentType.toLowerCase().includes('mpegurl') ||
        finalUrl.split('?')[0].toLowerCase().endsWith('.m3u8');

      if (isHlsPlaylist && upstream.ok) {
        const text = await upstream.text();
        const rewritten = rewriteHlsManifest(text, finalUrl, relayPrefix);
        res.status(upstream.status);
        res.setHeader(
          'Content-Type',
          'application/vnd.apple.mpegurl; charset=utf-8'
        );
        res.setHeader('Cache-Control', 'no-store');
        res.send(rewritten);
        return;
      }

      res.status(upstream.status);
      const forwardHeaders = [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
      ];
      for (const h of forwardHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      res.setHeader('Cache-Control', 'no-store');

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import('node:stream/web').ReadableStream
      );
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? `Stream-Relay fehlgeschlagen: ${err.message}`
            : 'Stream-Relay fehlgeschlagen.',
      });
    }
  };

  app.get('/api/stream-relay', async (req, res) => {
    const rawUrl = typeof req.query.u === 'string' ? req.query.u.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Parameter u (Stream-URL) fehlt.' });
      return;
    }
    await proxyUpstreamStream(rawUrl, '/api/stream-relay?u=', req, res);
  });

  app.head('/api/channels/:id/stream', async (req, res) => {
    const channel = resolveChannelById(req.params.id);
    if (!channel) {
      res.status(404).end();
      return;
    }
    const subUrl = typeof req.query.u === 'string' ? req.query.u.trim() : '';
    const targetUrl = subUrl || channel.upstreamUrl || '';
    if (!targetUrl || !isValidUpstreamUrl(targetUrl) || !isRelaySafeUrl(targetUrl)) {
      res.status(422).end();
      return;
    }
    const probe = await probeHttpEndpoint(targetUrl, 4000);
    const isHls = targetUrl.split('?')[0].toLowerCase().endsWith('.m3u8');
    res.setHeader(
      'Content-Type',
      isHls
        ? 'application/vnd.apple.mpegurl; charset=utf-8'
        : 'application/octet-stream'
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.status(probe.ok ? 200 : probe.httpStatus || 502).end();
  });

  app.get('/api/channels/:id/stream', async (req, res) => {
    const channel = resolveChannelById(req.params.id);
    if (!channel) {
      res.status(404).json({ error: 'Kanal nicht gefunden.' });
      return;
    }
    const subUrl = typeof req.query.u === 'string' ? req.query.u.trim() : '';
    const targetUrl = subUrl || channel.upstreamUrl || '';
    if (!targetUrl || !isValidUpstreamUrl(targetUrl)) {
      res.status(422).json({
        error:
          'Für diesen Kanal ist keine externe Upstream-Stream-URL hinterlegt. Lokale LAN-IPs sind nur direkt im Heimnetz erreichbar.',
      });
      return;
    }

    await proxyUpstreamStream(
      targetUrl,
      `/api/channels/${encodeURIComponent(channel.id)}/stream?u=`,
      req,
      res
    );
  });

  app.post('/api/ip-profiles', (req, res) => {
    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const baseIp = typeof body.baseIp === 'string' ? body.baseIp.trim() : '';
    const startPort = Number(body.startPort);

    if (!name) {
      res.status(400).json({ error: 'Profilname erforderlich.' });
      return;
    }
    if (!isValidIPv4(baseIp)) {
      res.status(400).json({ error: 'Ungültige Basis-IPv4-Adresse.' });
      return;
    }
    if (!isValidPort(startPort)) {
      res.status(400).json({ error: 'Ungültiger Start-Port.' });
      return;
    }

    const profile: IpProfile = {
      id: makeId('prof', name),
      name,
      description:
        typeof body.description === 'string' ? body.description.trim() : '',
      baseIp,
      startPort,
      protocol: VALID_PROTOCOLS.includes(body.protocol) ? body.protocol : 'http',
      mode:
        body.mode === 'increment-ip' ||
        body.mode === 'provider-blocks' ||
        body.mode === 'increment-port'
          ? body.mode
          : 'increment-port',
      pathPrefix: typeof body.pathPrefix === 'string' ? body.pathPrefix.trim() : '/live',
    };

    store.ipProfiles.unshift(profile);
    saveStore(store);
    res.status(201).json({ profile, store });
  });

  app.delete('/api/ip-profiles/:id', (req, res) => {
    store.ipProfiles = store.ipProfiles.filter((p) => p.id !== req.params.id);
    saveStore(store);
    res.json({ store });
  });

  app.post('/api/store/restore-json', (req, res) => {
    const body = req.body as Partial<CentralStore> | undefined;
    if (!body || !Array.isArray(body.channels) || !Array.isArray(body.playlists)) {
      res.status(400).json({ error: 'Ungültiges Sicherungsformat (channels/playlists fehlen).' });
      return;
    }
    store = {
      channels: body.channels,
      playlists: body.playlists,
      ipProfiles: Array.isArray(body.ipProfiles) ? body.ipProfiles : store.ipProfiles,
      streamSources: Array.isArray(body.streamSources)
        ? body.streamSources
        : store.streamSources ?? [],
    };
    saveStore(store);
    res.json({ store });
  });

  app.post('/api/store/reset', (_req, res) => {
    store = createInitialStore();
    saveStore(store);
    res.json({ store });
  });

  const BUILTIN_DE_FEED_M3U = `#EXTM3U x-tvg-url=""
#EXTINF:-1 tvg-id="das-erste" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",Das Erste HD (ARD)
https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8
#EXTINF:-1 tvg-id="zdf-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ZDF HD
https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8
#EXTINF:-1 tvg-id="zdf-neo" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ZDFneo HD
https://zdf-hls-16.akamaized.net/hls/live/2016499/de/high/master.m3u8
#EXTINF:-1 tvg-id="zdf-info" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ZDFinfo HD
https://zdf-hls-17.akamaized.net/hls/live/2016500/de/high/master.m3u8
#EXTINF:-1 tvg-id="arte-de" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ARTE Deutschland HD
https://artesimulcast.akamaized.net/hls/live/2030993/artelive_de/index.m3u8
#EXTINF:-1 tvg-id="dreisat" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",3sat HD
https://zdf-hls-18.akamaized.net/hls/live/2016501/dach/high/master.m3u8
#EXTINF:-1 tvg-id="phoenix" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",Phoenix HD
https://zdf-hls-19.akamaized.net/hls/live/2016502/de/high/master.m3u8
#EXTINF:-1 tvg-id="tagesschau24" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",tagesschau24 HD
https://tagesschau.akamaized.net/hls/live/2020115/tagesschau/tagesschau_1/master.m3u8
#EXTINF:-1 tvg-id="kika" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",KiKA HD
https://kikageohls.akamaized.net/hls/live/2022693-b/livetvkika_de/master.m3u8
#EXTINF:-1 tvg-id="one-hd-ard" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ONE HD (ARD)
https://mcdn-one.ard.de/ardone/hls/master.m3u8
#EXTINF:-1 tvg-id="ard-alpha-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",ARD-alpha HD
https://mcdn.br.de/br/fs/ard_alpha/hls/de/master.m3u8
#EXTINF:-1 tvg-id="wdr-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",WDR Fernsehen HD
https://wdr-live.ard-mcdn.de/wdr/live/hls/de/master.m3u8
#EXTINF:-1 tvg-id="br-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",BR Fernsehen Süd HD
https://mcdn.br.de/br/fs/bfs_sued/hls/de/master.m3u8
#EXTINF:-1 tvg-id="br-nord-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",BR Fernsehen Nord HD
https://mcdn.br.de/br/fs/bfs_nord/hls/de/master.m3u8
#EXTINF:-1 tvg-id="ndr-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",NDR Fernsehen NDS HD
https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_nds/master.m3u8
#EXTINF:-1 tvg-id="ndr-hh-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",NDR Fernsehen Hamburg HD
https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_hh/master.m3u8
#EXTINF:-1 tvg-id="swr-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",SWR Fernsehen BW HD
https://swrbwd-hls.akamaized.net/hls/live/2018672/swrbwd/master.m3u8
#EXTINF:-1 tvg-id="mdr-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",MDR Fernsehen HD
https://mdrtvsnhls.akamaized.net/hls/live/2016928/mdrtvsn/master.m3u8
#EXTINF:-1 tvg-id="hr-fernsehen-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",hr-fernsehen HD
https://hrhlsde.akamaized.net/hls/live/2024526/hrhlsde/index.m3u8
#EXTINF:-1 tvg-id="rbb-berlin-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",rbb Fernsehen Berlin HD
https://rbb-hls-berlin.akamaized.net/hls/live/2017824/rbb_berlin/index.m3u8
#EXTINF:-1 tvg-id="rbb-brandenburg-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",rbb Brandenburg HD
https://rbb-hls-brandenburg.akamaized.net/hls/live/2017825/rbb_brandenburg/index.m3u8
#EXTINF:-1 tvg-id="sr-fernsehen-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",SR Fernsehen HD
https://srfs.akamaized.net/hls/live/689649/srfsgeo/index.m3u8
#EXTINF:-1 tvg-id="radio-bremen-tv" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",Radio Bremen TV HD
https://rbhlslive.akamaized.net/hls/live/2020435/rbfs/master.m3u8
#EXTINF:-1 tvg-id="dw-deutsch-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",DW Deutsch HD (Deutsche Welle)
https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8
#EXTINF:-1 tvg-id="rtl-hd" tvg-language="Deutsch (DE)" group-title="Private DE",RTL HD
https://dash4.antik.sk/live/test_rtl_ger_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="prosieben-hd" tvg-language="Deutsch (DE)" group-title="Private DE",ProSieben HD
https://dash4.antik.sk/live/test_pro_sieben_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="vox-hd" tvg-language="Deutsch (DE)" group-title="Private DE",VOX HD
https://dash4.antik.sk/live/test_vox_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="kabel-eins" tvg-language="Deutsch (DE)" group-title="Private DE",Kabel Eins HD
https://dash4.antik.sk/live/test_kabel_eins_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="rtl-zwei" tvg-language="Deutsch (DE)" group-title="Private DE",RTLZWEI HD
https://dash4.antik.sk/live/test_rtl_zwei_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="sixx-hd" tvg-language="Deutsch (DE)" group-title="Private DE",sixx HD
https://dash4.antik.sk/live/test_sixx_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="sat1-gold-hd" tvg-language="Deutsch (DE)" group-title="Private DE",SAT.1 Gold HD
https://dash4.antik.sk/live/test_sat_eins_gold_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="ntv-hd" tvg-language="Deutsch (DE)" group-title="Private DE",n-tv HD
https://dash4.antik.sk/live/test_ntv_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="welt-hd" tvg-language="Deutsch (DE)" group-title="Private DE",WELT HD
https://dash4.antik.sk/live/test_welt_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="deluxe-music-hd" tvg-language="Deutsch (DE)" group-title="Private DE",DELUXE MUSIC HD
https://sdn-global-live-streaming-packager-cache.3qsdn.com/13456/13456_264_live.m3u8
#EXTINF:-1 tvg-id="prosieben-maxx" tvg-language="Deutsch (DE)" group-title="Private DE",ProSieben MAXX HD
https://s6.hopslan.com/pro7maxxX/index.m3u8
#EXTINF:-1 tvg-id="dmax-hd" tvg-language="Deutsch (DE)" group-title="Private DE",DMAX HD
https://s6.hopslan.com/dmaxX/index.m3u8
#EXTINF:-1 tvg-id="eurosport1-de" tvg-language="Deutsch (DE)" group-title="Private DE",Eurosport 1 Deutschland HD
http://90.183.52.46:4000/play/a06v/index.m3u8
#EXTINF:-1 tvg-id="disney-channel-de" tvg-language="Deutsch (DE)" group-title="Disney+",Disney Channel DE HD
https://s6.hopslan.com/disneyX/index.m3u8
#EXTINF:-1 tvg-id="tele5-de" tvg-language="Deutsch (DE)" group-title="Private DE",TELE 5 HD
https://s6.hopslan.com/tele5X/index.m3u8
#EXTINF:-1 tvg-id="nitro-hd" tvg-language="Deutsch (DE)" group-title="Private DE",NITRO HD
https://dash4.antik.sk/live/test_rtl_nitro_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="rtl-super" tvg-language="Deutsch (DE)" group-title="Private DE",RTL Super HD
https://s6.hopslan.com/superX/index.m3u8
#EXTINF:-1 tvg-id="rtlup-hd" tvg-language="Deutsch (DE)" group-title="Private DE",RTLup HD
https://s6.hopslan.com/rtltupz/index.m3u8
#EXTINF:-1 tvg-id="voxup-hd" tvg-language="Deutsch (DE)" group-title="Private DE",VOXup HD
https://s6.hopslan.com/voxupz/index.m3u8
#EXTINF:-1 tvg-id="kabel-eins-doku" tvg-language="Deutsch (DE)" group-title="Private DE",kabel eins Doku HD
https://s6.hopslan.com/dokuX/index.m3u8
#EXTINF:-1 tvg-id="comedy-central-de" tvg-language="Deutsch (DE)" group-title="Private DE",Comedy Central DE HD
https://ma.anixa.tv/clips/stream/comedy_central/playlist.php
#EXTINF:-1 tvg-id="mtv-de" tvg-language="Deutsch (DE)" group-title="Private DE",MTV Germany HD
https://ma.anixa.tv/clips/stream/mtv/playlist.php
#EXTINF:-1 tvg-id="nickelodeon-de" tvg-language="Deutsch (DE)" group-title="Private DE",Nickelodeon DE HD
https://ma.anixa.tv/clips/stream/nickelodeon/playlist.php
#EXTINF:-1 tvg-id="more-than-sports-tv" tvg-language="Deutsch (DE)" group-title="Private DE",More Than Sports TV HD
https://mts1.iptv-playoutcenter.de/mts/mts-web/playlist.m3u8
#EXTINF:-1 tvg-id="dokusat-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Dokusat HD
https://muc3.iptv-playoutcenter.de/dokusat/dokusat1/playlist.m3u8
#EXTINF:-1 tvg-id="orf1-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF 1 HD (AT)
https://test02.mdn.ors.at/orf/orf1/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="orf2-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF 2 HD (AT)
http://88.212.7.14/live/test_orf_zwei_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="orf3-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF III HD (AT)
https://orf3.mdn.ors.at/orf/orf3/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="orfsport-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF Sport+ HD (AT)
https://test02.mdn.ors.at/orf/orfs/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="alex-berlin-hd" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",Alex Berlin TV HD
https://alex-stream.rosebud-media.de/bounce/alexlivetv50.smil/index.m3u8
#EXTINF:-1 tvg-id="dasding-tv" tvg-language="Deutsch (DE)" group-title="Öffentlich-Rechtlich",DASDING 90.8 Live (SWR)
https://swrdasdingvr-hls.akamaized.net/hls/live/2018681/dasdingvr/master.m3u8
#EXTINF:-1 tvg-id="deluxe-rap-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Deluxe Rap HD
https://sdn-global-live-streaming-packager-cache.3qsdn.com/65183/65183_264_live.m3u8
#EXTINF:-1 tvg-id="dmf-tv-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Deutsches Musik Fernsehen (DMF)
https://d-m-f.iptv-playoutcenter.de/dmf/dmf1/playlist.m3u8
#EXTINF:-1 tvg-id="allgaeu-tv-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Allgäu TV HD
https://stream01.welocal.stream/stream/fhd-allgaeutv_25679/ngrp:stream_all/playlist.m3u8
#EXTINF:-1 tvg-id="augsburg-tv-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Augsburg TV HD
https://stream02.welocal.stream/stream/fhd-augsburgtv_104951/ngrp:stream_all/playlist.m3u8
`;

  const BUILTIN_DE_FAST_FEED_M3U = `#EXTM3U x-tvg-url=""
#EXTINF:-1 tvg-id="red-bull-tv-de" tvg-language="Deutsch (DE)" group-title="Sport & Action",Red Bull TV DE
https://46cfeb23c7f74853bba7a256655a3119.mediatailor.us-west-2.amazonaws.com/v1/master/ba62fe743df0fe93366eba3a257d792884136c7f/LINEAR-582-WORBDACHDEFAST-WHALETVPLUS/582/whaletvplus/hls/master/playlist.m3u8
#EXTINF:-1 tvg-id="world-of-freesports" tvg-language="Deutsch (DE)" group-title="Sport & Action",World of Freesports HD
https://mainstreammedia-worldoffreesportsintl-rakuten.amagi.tv/playlist.m3u8
#EXTINF:-1 tvg-id="dazn-darts-pluto" tvg-language="Deutsch (DE)" group-title="Sport & Live",DAZN Darts x Pluto TV
https://jmp2.uk/plu-64b67f0424ade50008a3be17.m3u8
#EXTINF:-1 tvg-id="dazn-heldinnen-pluto" tvg-language="Deutsch (DE)" group-title="Sport & Live",DAZN Heldinnen x Pluto TV
https://jmp2.uk/plu-64afe50c5dc16600087f3227.m3u8
#EXTINF:-1 tvg-id="fifa-plus-de" tvg-language="Deutsch (DE)" group-title="Sport & Live",FIFA+ German HD
https://4397879b.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmFrdXRlblRWLWRlX0ZJRkFQbHVzR2VybWFuX0hMUw/playlist.m3u8
#EXTINF:-1 tvg-id="strongman-de" tvg-language="Deutsch (DE)" group-title="Sport & Action",Strongman Champions League
https://rightsboosterltd-scl-2-eu.rakuten.wurl.tv/playlist.m3u8
#EXTINF:-1 tvg-id="wpt-germany" tvg-language="Deutsch (DE)" group-title="Sport & Action",World Poker Tour Germany
https://jmp2.uk/plu-5ad9b7aae738977e2c312132.m3u8
#EXTINF:-1 tvg-id="n24-doku-hd" tvg-language="Deutsch (DE)" group-title="Private DE",N24 Doku HD
https://jmp2.uk/plu-60080e8a4bf36000076a81b1.m3u8
#EXTINF:-1 tvg-id="welt-der-wunder-tv" tvg-language="Deutsch (DE)" group-title="Private DE",Welt der Wunder TV
https://wdw.iptv-playoutcenter.de/wdw/wdw1/playlist.m3u8
#EXTINF:-1 tvg-id="terra-mater-wild" tvg-language="Deutsch (DE)" group-title="Natur & Doku",Terra Mater WILD HD
https://53ff3982.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmxheHhUVi1ldV9UZXJyYU1hdGVyV2lsZF9ITFM/playlist.m3u8
#EXTINF:-1 tvg-id="wedo-big-stories" tvg-language="Deutsch (DE)" group-title="Wissen & Doku",Wedo Big Stories HD
https://amg00735-videosolutionsa-wedobigdocs-ono-0urlz.amagi.tv/playlist/amg00735-videosolutionsa-wedobigdocs-ono/playlist.m3u8
#EXTINF:-1 tvg-id="bbc-travel-de" tvg-language="Deutsch (DE)" group-title="Reisen & Doku",BBC Travel DE
https://jmp2.uk/plu-60e4519e6873180007d3cddb.m3u8
#EXTINF:-1 tvg-id="autentic-travel-de" tvg-language="Deutsch (DE)" group-title="Reisen & Doku",Autentic Travel HD
https://0876432b34c349e6b4f3a18df2213adc.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticTravel/playlist.m3u8
#EXTINF:-1 tvg-id="autentic-history-de" tvg-language="Deutsch (DE)" group-title="Geschichte & Doku",Autentic History HD
https://9e754fa707344ccca6d84955c8fcaf36.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticHistory/playlist.m3u8
#EXTINF:-1 tvg-id="curiosity-channel-de" tvg-language="Deutsch (DE)" group-title="Wissen & Doku",Curiosity Channel DE
https://jmp2.uk/plu-6576c20fb3801200084786c9.m3u8
#EXTINF:-1 tvg-id="zee-one-de" tvg-language="Deutsch (DE)" group-title="Private DE",Zee One Deutsch HD
https://e4955b54.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/U2Ftc3VuZy1kZV9aZWVPbmVfSExT/playlist.m3u8
#EXTINF:-1 tvg-id="pluto-tv-kultfilme" tvg-language="Deutsch (DE)" group-title="Kino & Filme",Pluto TV Kultfilme DE
https://jmp2.uk/plu-5dde47b63585b500099f74ec.m3u8
#EXTINF:-1 tvg-id="pluto-tv-movies" tvg-language="Deutsch (DE)" group-title="Kino & Filme",Pluto TV Movies DE
https://jmp2.uk/plu-5c5c3b948002db3c3e0b262e.m3u8
#EXTINF:-1 tvg-id="moviedome-de" tvg-language="Deutsch (DE)" group-title="Kino & Filme",Moviedome DE HD
https://jmp2.uk/plu-615c1e5ce3039400070a0547.m3u8
#EXTINF:-1 tvg-id="pluto-tv-crime" tvg-language="Deutsch (DE)" group-title="Krimi & Thriller",Pluto TV Crime DE
https://jmp2.uk/plu-5e7b6c60fd20c50007910bf5.m3u8
#EXTINF:-1 tvg-id="pluto-tv-nature" tvg-language="Deutsch (DE)" group-title="Natur & Doku",Pluto TV Nature DE
https://jmp2.uk/plu-5be1c3f9851dd5632e2c91b2.m3u8
#EXTINF:-1 tvg-id="pluto-tv-animals" tvg-language="Deutsch (DE)" group-title="Natur & Doku",Pluto TV Animals DE
https://jmp2.uk/plu-5d767ae7b456c8cf265ce922.m3u8
#EXTINF:-1 tvg-id="pluto-tv-explore" tvg-language="Deutsch (DE)" group-title="Wissen & Doku",Pluto TV Explore DE
https://jmp2.uk/plu-5ad9b8551b95267e225e59c1.m3u8
#EXTINF:-1 tvg-id="pluto-tv-space" tvg-language="Deutsch (DE)" group-title="Wissen & Doku",Pluto TV Space DE
https://jmp2.uk/plu-61409f8d6feb30000766b675.m3u8
#EXTINF:-1 tvg-id="pluto-tv-mystery" tvg-language="Deutsch (DE)" group-title="Dokumentation",Pluto TV Mystery DE
https://jmp2.uk/plu-617aad99b68ef100072608cd.m3u8
#EXTINF:-1 tvg-id="pluto-tv-food" tvg-language="Deutsch (DE)" group-title="Kochen & Doku",Pluto TV Food DE
https://jmp2.uk/plu-5dc280c9aa218c0009724b4b.m3u8
#EXTINF:-1 tvg-id="waterbear-doc" tvg-language="Deutsch (DE)" group-title="Natur & Doku",WaterBear HD (Natur-Doku)
https://amg01415-waterbearnetwor-waterbear-samsunguk-1h0y8.amagi.tv/playlist/amg01415-waterbearnetwor-waterbear-samsunguk/playlist.m3u8
#EXTINF:-1 tvg-id="pluto-tv-comedy-de" tvg-language="Deutsch (DE)" group-title="Comedy",Pluto TV Deutsche Comedy
https://jmp2.uk/plu-6672f49f61a39900089db68e.m3u8
#EXTINF:-1 tvg-id="deluxe-lounge-hd" tvg-language="Deutsch (DE)" group-title="Private DE",Deluxe Lounge HD
https://jmp2.uk/stvp-CHAJ0500413A
#EXTINF:-1 tvg-id="xite-hits-de" tvg-language="Deutsch (DE)" group-title="Private DE",XITE Hits Germany HD
https://d726x48n2pd5h.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-skxr1pazhltvp/XITE_Hits.m3u8
#EXTINF:-1 tvg-id="star-trek-tng-de" tvg-language="Deutsch (DE)" group-title="Sci-Fi & Serien",Star Trek: The Next Generation DE
https://jmp2.uk/plu-69776ce979545c21a1220bff.m3u8
#EXTINF:-1 tvg-id="naruto-de" tvg-language="Deutsch (DE)" group-title="Anime & Serien",Naruto Germany HD
https://jmp2.uk/plu-65d5fc39a25d5e00082895c4.m3u8
#EXTINF:-1 tvg-id="spongebob-de" tvg-language="Deutsch (DE)" group-title="Kinder",SpongeBob Schwammkopf DE
https://jmp2.uk/plu-5d00e8adaab96b5635b2a005.m3u8
#EXTINF:-1 tvg-id="rakuten-action-de" tvg-language="Deutsch (DE)" group-title="Kino & Action",Rakuten TV Action Movies DE
https://284824cf70404fdfb6ddf9349009c710.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6066/master.m3u8
#EXTINF:-1 tvg-id="rakuten-comedy-de" tvg-language="Deutsch (DE)" group-title="Comedy & Kino",Rakuten TV Comedy Movies DE
https://ecac08c9e2214375b907d6825aaf9a01.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6182/master.m3u8
#EXTINF:-1 tvg-id="rakuten-drama-de" tvg-language="Deutsch (DE)" group-title="Kino & Drama",Rakuten TV Drama Movies DE
https://968754c2483045c1a9a7f677caec35b6.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6096/master.m3u8
#EXTINF:-1 tvg-id="rakuten-family-de" tvg-language="Deutsch (DE)" group-title="Kinder & Familie",Rakuten TV Family Movies DE
https://af230031eeac45f3b78d4f8a13265105.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6209/master.m3u8
#EXTINF:-1 tvg-id="adventure-earth-hd" tvg-language="Deutsch (DE)" group-title="Natur & Doku",Adventure Earth HD (DE)
https://a57e9c69976649b582a8d7604c00e69a.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AdventureEarth/playlist.m3u8
#EXTINF:-1 tvg-id="folx-music-tv" tvg-language="Deutsch (DE)" group-title="Musik",Folx Music Television HD
https://folxapp.b-cdn.net/1080p/index.m3u8
#EXTINF:-1 tvg-id="one-music-tv" tvg-language="Deutsch (DE)" group-title="Musik",One Music Television HD
https://oneapp.b-cdn.net/1080p/index.m3u8
#EXTINF:-1 tvg-id="zwei-music-tv" tvg-language="Deutsch (DE)" group-title="Musik",Zwei Music Television HD
https://zweiapp.b-cdn.net/1080p/index.m3u8
#EXTINF:-1 tvg-id="volksmusik-tv" tvg-language="Deutsch (DE)" group-title="Musik",Volksmusik TV
https://vmtv.iptv-playoutcenter.de/vmtv/vmtv1/playlist.m3u8
#EXTINF:-1 tvg-id="adria-music-tv" tvg-language="Deutsch (DE)" group-title="Musik",Adria Music Television HD
https://adriaapp.b-cdn.net/1080p/index.m3u8
`;

  const BUILTIN_DACH_FALLBACK_M3U = `#EXTM3U x-tvg-url=""
#EXTINF:-1 tvg-id="orf1-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF 1 HD (AT)
https://test02.mdn.ors.at/orf/orf1/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="orf2-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF 2 HD (AT)
http://88.212.7.14/live/test_orf_zwei_tizen/playlist.m3u8
#EXTINF:-1 tvg-id="orf3-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF III HD (AT)
https://orf3.mdn.ors.at/orf/orf3/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="orfsport-hd" tvg-language="Deutsch (AT)" group-title="AT & CH",ORF Sport+ HD (AT)
https://test02.mdn.ors.at/orf/orfs/qxa/manifest.m3u8
#EXTINF:-1 tvg-id="okto-tv-wien" tvg-language="Deutsch (AT)" group-title="AT & CH",Okto TV Wien HD (AT)
https://cdn3.wowza.com/1/MHFtazJReW5rOFhP/N2NWNDZ2/hls/live/playlist.m3u8
#EXTINF:-1 tvg-id="kronehit-tv-at" tvg-language="Deutsch (AT)" group-title="AT & CH",Kronehit TV HD (AT)
https://bitcdn-kronehit.bitmovin.com/v2/hls/playlist.m3u8
#EXTINF:-1 tvg-id="tv1-oberoesterreich" tvg-language="Deutsch (AT)" group-title="AT & CH",TV1 Oberösterreich HD (AT)
https://streaming10.huberwebmedia.at/LiveApp/streams/238985177034727564068269_adaptive.m3u8
#EXTINF:-1 tvg-id="meteonews-ch" tvg-language="Deutsch (CH)" group-title="AT & CH",Meteonews TV HD (CH)
https://streaming.meteonews.net/hls/stream.m3u8
#EXTINF:-1 tvg-id="teleticino-ch" tvg-language="Schweiz (CH)" group-title="AT & CH",TeleTicino HD (CH)
https://vstream-cdn.ch/hls/teleticino.m3u8
#EXTINF:-1 tvg-id="carac1-ch" tvg-language="Schweiz (CH)" group-title="AT & CH",Carac 1 HD (CH)
https://edge13.vedge.infomaniak.com/livecast/ik:event/manifest.m3u8
#EXTINF:-1 tvg-id="carac2-ch" tvg-language="Schweiz (CH)" group-title="AT & CH",Carac 2 HD (CH)
https://onefmhd.vedge.infomaniak.com/livecast/ik:onefmhd/manifest.m3u8
#EXTINF:-1 tvg-id="carac3-ch" tvg-language="Schweiz (CH)" group-title="AT & CH",Carac 3 HD (CH)
https://lfmhd.vedge.infomaniak.com/livecast/lfmhd/playlist.m3u8
#EXTINF:-1 tvg-id="canal-alpha-ch" tvg-language="Schweiz (CH)" group-title="AT & CH",Canal Alpha Jura HD (CH)
https://canalalphaju.vedge.infomaniak.com/livecast/ik:canalalphaju/playlist.m3u8
`;

  let iptvOrgDachCache: { m3u: string; fetchedAt: number } | null = null;
  let iptvOrgDachInFlight: Promise<string> | null = null;
  const BLOCKED_DACH_HOST_PATTERNS = [
    'mcdn.wdr.de',
    'live2weltcms',
    'swrrpd',
    'mdrtvsa',
    'mdrtvth',
    'dwstream72',
    'rt-fra.rttv.com',
  ];

  async function buildIptvOrgDachFeedM3U(): Promise<string> {
    if (
      iptvOrgDachCache &&
      Date.now() - iptvOrgDachCache.fetchedAt < 10 * 60_000
    ) {
      return iptvOrgDachCache.m3u;
    }
    if (iptvOrgDachInFlight) {
      return iptvOrgDachInFlight;
    }

    iptvOrgDachInFlight = (async () => {
      try {
        const sources: Array<{ country: string; url: string; lang: string }> = [
          {
            country: 'DE',
            url: 'https://iptv-org.github.io/iptv/countries/de.m3u',
            lang: 'Deutsch (DE)',
          },
          {
            country: 'AT',
            url: 'https://iptv-org.github.io/iptv/countries/at.m3u',
            lang: 'Deutsch (AT)',
          },
          {
            country: 'CH',
            url: 'https://iptv-org.github.io/iptv/countries/ch.m3u',
            lang: 'Deutsch / CH',
          },
        ];

        const rawTexts = await Promise.all(
          sources.map(async (src) => {
            try {
              const r = await fetch(src.url, {
                headers: { 'User-Agent': 'StreamGrid-DE-SourceSync/1.0' },
                signal: AbortSignal.timeout(7000),
              });
              if (!r.ok) return { src, text: '' };
              return { src, text: await r.text() };
            } catch {
              return { src, text: '' };
            }
          })
        );

        const candidates: Array<{
          name: string;
          tvgId: string;
          group: string;
          lang: string;
          url: string;
        }> = [];
        const seenUrls = new Set<string>();
        const seenNames = new Set<string>();

        for (const { src, text } of rawTexts) {
          if (!text) continue;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('#EXTINF')) continue;
            const streamUrl = (lines[i + 1] || '').trim();
            if (!streamUrl.startsWith('http') || streamUrl.length > 480) continue;
            if (BLOCKED_DACH_HOST_PATTERNS.some((p) => streamUrl.includes(p))) {
              continue;
            }
            const commaIdx = line.indexOf(',');
            const rawName = (commaIdx >= 0 ? line.slice(commaIdx + 1) : '')
              .replace(/\s*\(\d+p\)/gi, '')
              .trim();
            if (
              !rawName ||
              /\[Not 24\/7\]|\[Geo-blocked\]/i.test(rawName)
            ) {
              continue;
            }
            const normUrl = streamUrl.toLowerCase();
            const normName = rawName.toLowerCase();
            if (seenUrls.has(normUrl) || seenNames.has(normName)) continue;
            seenUrls.add(normUrl);
            seenNames.add(normName);

            const tvgIdMatch = /tvg-id="([^"]*)"/i.exec(line);
            const grpMatch = /group-title="([^"]*)"/i.exec(line);
            const cleanGroup =
              src.country === 'AT' || src.country === 'CH'
                ? 'AT & CH'
                : grpMatch?.[1]?.split(';')[0]?.trim() || 'DACH Live';

            candidates.push({
              name: rawName.slice(0, 100),
              tvgId: (
                tvgIdMatch?.[1]?.trim() || slugifyChannelName(rawName)
              ).slice(0, 100),
              group: cleanGroup.slice(0, 70),
              lang: src.lang,
              url: streamUrl,
            });
          }
        }

        if (candidates.length === 0) {
          iptvOrgDachCache = {
            m3u: BUILTIN_DACH_FALLBACK_M3U,
            fetchedAt: Date.now(),
          };
          return BUILTIN_DACH_FALLBACK_M3U;
        }

        // Probe reachable HLS entries in small parallel batches, capped at 70 live channels
        const verified: typeof candidates = [];
        const probeSubset = candidates.slice(0, 130);
        for (let i = 0; i < probeSubset.length && verified.length < 70; i += 25) {
          const batch = probeSubset.slice(i, i + 25);
          const checked = await Promise.all(
            batch.map(async (item) => {
              try {
                const r = await fetch(item.url, {
                  headers: { 'User-Agent': 'VLC/3.0.20' },
                  redirect: 'follow',
                  signal: AbortSignal.timeout(2200),
                });
                if (!r.ok) {
                  await r.body?.cancel().catch(() => {});
                  return null;
                }
                const body = await r.text();
                return body.includes('#EXTM3U') ? item : null;
              } catch {
                return null;
              }
            })
          );
          for (const ok of checked) {
            if (ok && verified.length < 70) {
              verified.push(ok);
            }
          }
        }

        const finalEntries = verified.length > 0 ? verified : candidates.slice(0, 40);
        const outLines = ['#EXTM3U x-playlist-name="IPTV-org DACH (Live-Import)"'];
        for (const entry of finalEntries) {
          outLines.push(
            `#EXTINF:-1 tvg-id="${entry.tvgId.replace(/"/g, "'")}" tvg-language="${entry.lang}" group-title="${entry.group.replace(/"/g, "'")}",${entry.name}`
          );
          outLines.push(entry.url);
        }
        const m3u = outLines.join('\n') + '\n';
        iptvOrgDachCache = { m3u, fetchedAt: Date.now() };
        return m3u;
      } catch {
        return BUILTIN_DACH_FALLBACK_M3U;
      } finally {
        iptvOrgDachInFlight = null;
      }
    })();

    return iptvOrgDachInFlight;
  }

  app.get('/api/feeds/de-live-quellen.m3u', (_req, res) => {
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(BUILTIN_DE_FEED_M3U);
  });

  app.get('/api/feeds/de-fast-live.m3u', (_req, res) => {
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(BUILTIN_DE_FAST_FEED_M3U);
  });

  app.get('/api/feeds/iptv-org-dach.m3u', async (_req, res) => {
    const m3u = await buildIptvOrgDachFeedM3U();
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(m3u);
  });

  const fetchRawM3UFromSourceUrl = async (rawUrl: string): Promise<string> => {
    const trimmed = rawUrl.trim();
    if (trimmed === '/api/feeds/de-live-quellen.m3u') {
      return BUILTIN_DE_FEED_M3U;
    }
    if (trimmed === '/api/feeds/de-fast-live.m3u') {
      return BUILTIN_DE_FAST_FEED_M3U;
    }
    if (trimmed === '/api/feeds/iptv-org-dach.m3u') {
      return buildIptvOrgDachFeedM3U();
    }
    if (!isRelaySafeUrl(trimmed)) {
      throw new Error(
        'Quell-URL blockiert oder ungültig. Nur öffentliche http(s):// M3U-URLs oder interne Basis-Feeds sind erlaubt.'
      );
    }
    const upstream = await fetch(trimmed, {
      headers: {
        'User-Agent': 'StreamGrid-DE-SourceSync/1.0',
        Accept: 'application/vnd.apple.mpegurl, audio/x-mpegurl, text/plain, */*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      throw new Error(`Quelle antwortet mit HTTP ${upstream.status}`);
    }
    const text = await upstream.text();
    if (text.length > 5_000_000) {
      throw new Error('M3U-Quelldatei überschreitet das Limit von 5 MB.');
    }
    return text;
  };

  const activeSourceSyncs = new Set<string>();

  const runServerSourceSync = async (
    sourceId: string
  ): Promise<{
    source: StreamSource;
    logEntry: SourceSyncLogItem;
  }> => {
    const sources = store.streamSources ?? [];
    const idx = sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) {
      throw new Error('Quelle nicht gefunden.');
    }
    if (activeSourceSyncs.has(sourceId)) {
      const current = sources[idx];
      return {
        source: current,
        logEntry: {
          id: makeId('log', current.name),
          sourceId: current.id,
          sourceName: current.name,
          playlistName: current.targetPlaylistName,
          addedCount: 0,
          updatedCount: 0,
          linkedCount: 0,
          totalCount: current.lastTotalCount ?? 0,
          status: 'ok',
          syncedAt: new Date().toISOString(),
        },
      };
    }

    activeSourceSyncs.add(sourceId);
    const source = sources[idx];
    const now = new Date().toISOString();

    try {
      const rawM3U = await fetchRawM3UFromSourceUrl(source.url);
      const entries = parseM3U(rawM3U, {
        defaultIp: source.defaultIp,
        startPort: source.startPort,
      });

      const merged = mergeParsedEntriesIntoStore({
        entries,
        source,
        channels: store.channels,
        playlists: store.playlists,
        nowIso: now,
      });

      store.channels = merged.nextChannels;
      store.playlists = merged.nextPlaylists;

      const updatedSource: StreamSource = {
        ...source,
        targetPlaylistId: merged.targetPlaylist.id,
        targetPlaylistName: merged.targetPlaylist.name,
        lastSyncedAt: now,
        lastStatus: 'ok',
        lastAddedCount: merged.addedChannels.length,
        lastUpdatedCount: merged.updatedChannels.length,
        lastTotalCount: merged.totalParsed,
        lastError: undefined,
        updatedAt: now,
      };

      const nextSources = [...(store.streamSources ?? [])];
      const latestIdx = nextSources.findIndex((s) => s.id === sourceId);
      if (latestIdx >= 0) {
        nextSources[latestIdx] = updatedSource;
      }
      store.streamSources = nextSources;
      saveStore(store);

      return {
        source: updatedSource,
        logEntry: {
          id: makeId('log', updatedSource.name),
          sourceId: updatedSource.id,
          sourceName: updatedSource.name,
          playlistName: merged.targetPlaylist.name,
          addedCount: merged.addedChannels.length,
          updatedCount: merged.updatedChannels.length,
          linkedCount: merged.newlyLinkedCount,
          totalCount: merged.totalParsed,
          status: 'ok',
          syncedAt: now,
        },
      };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Quellen-Abgleich fehlgeschlagen.';
      const nextSources = [...(store.streamSources ?? [])];
      const latestIdx = nextSources.findIndex((s) => s.id === sourceId);
      const erroredSource: StreamSource = {
        ...(latestIdx >= 0 ? nextSources[latestIdx] : source),
        lastSyncedAt: now,
        lastStatus: 'error',
        lastError: errMsg,
        updatedAt: now,
      };
      if (latestIdx >= 0) {
        nextSources[latestIdx] = erroredSource;
        store.streamSources = nextSources;
        saveStore(store);
      }
      return {
        source: erroredSource,
        logEntry: {
          id: makeId('log', erroredSource.name),
          sourceId: erroredSource.id,
          sourceName: erroredSource.name,
          playlistName: erroredSource.targetPlaylistName,
          addedCount: 0,
          updatedCount: 0,
          linkedCount: 0,
          totalCount: 0,
          status: 'error',
          error: errMsg,
          syncedAt: now,
        },
      };
    } finally {
      activeSourceSyncs.delete(sourceId);
    }
  };

  app.get('/api/sources', (_req, res) => {
    res.json({ streamSources: store.streamSources ?? [] });
  });

  app.post('/api/sources/fetch-m3u', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const defaultIp =
      typeof req.body?.defaultIp === 'string' && isValidIPv4(req.body.defaultIp)
        ? req.body.defaultIp.trim()
        : '192.168.178.150';
    const startPort = isValidPort(Number(req.body?.startPort))
      ? Number(req.body.startPort)
      : 8700;

    if (!isValidSourceUrl(rawUrl)) {
      res.status(400).json({
        error: 'Ungültige Quell-URL. Bitte eine http(s):// M3U-URL oder einen Basis-Feed angeben.',
      });
      return;
    }

    try {
      const rawM3U = await fetchRawM3UFromSourceUrl(rawUrl);
      const entries = parseM3U(rawM3U, { defaultIp, startPort });
      res.json({ entries, totalCount: entries.length });
    } catch (err) {
      res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : 'M3U-Quelle konnte nicht abgerufen werden.',
      });
    }
  });

  app.post('/api/sources', async (req, res) => {
    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const defaultIp =
      typeof body.defaultIp === 'string' && isValidIPv4(body.defaultIp)
        ? body.defaultIp.trim()
        : '192.168.178.150';
    const startPort = isValidPort(Number(body.startPort))
      ? Number(body.startPort)
      : 8700;
    const intervalMinutes = Math.max(
      1,
      Math.min(1440, Number(body.intervalMinutes) || 15)
    );
    const autoRefresh = body.autoRefresh !== false;
    const enabled = body.enabled !== false;

    if (!name) {
      res.status(400).json({ error: 'Bitte einen Namen für die Quelle angeben.' });
      return;
    }
    if (!isValidSourceUrl(url)) {
      res.status(400).json({
        error: 'Bitte eine gültige http(s):// M3U-URL oder den Basis-Feed angeben.',
      });
      return;
    }
    if (url.startsWith('http') && !isRelaySafeUrl(url)) {
      res.status(400).json({
        error: 'Private oder lokale Ziel-URLs sind aus Sicherheitsgründen im Cloud-Abruf gesperrt.',
      });
      return;
    }

    const now = new Date().toISOString();
    const targetPlaylistId =
      typeof body.targetPlaylistId === 'string' && body.targetPlaylistId.trim()
        ? body.targetPlaylistId.trim()
        : makeId('pl', body.targetPlaylistName || name);
    const existingTargetPl = store.playlists.find((p) => p.id === targetPlaylistId);
    const targetPlaylistName =
      existingTargetPl?.name ||
      (typeof body.targetPlaylistName === 'string' && body.targetPlaylistName.trim()
        ? body.targetPlaylistName.trim()
        : `Auto-Liste: ${name}`);

    const source: StreamSource = {
      id: makeId('src', name),
      name,
      url,
      targetPlaylistId,
      targetPlaylistName,
      autoRefresh,
      intervalMinutes,
      enabled,
      defaultIp,
      startPort,
      lastStatus: 'idle',
      updatedAt: now,
    };

    store.streamSources = [source, ...(store.streamSources ?? [])];
    saveStore(store);

    if (body.syncNow !== false && source.enabled) {
      const result = await runServerSourceSync(source.id);
      res.status(201).json({
        source: result.source,
        logEntry: result.logEntry,
        store,
      });
      return;
    }

    res.status(201).json({ source, store });
  });

  app.patch('/api/sources/:id', (req, res) => {
    const sources = store.streamSources ?? [];
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Quelle nicht gefunden.' });
      return;
    }

    const existing = sources[idx];
    const body = req.body ?? {};
    const nextUrl =
      typeof body.url === 'string' ? body.url.trim() : existing.url;

    if (!isValidSourceUrl(nextUrl)) {
      res.status(400).json({ error: 'Ungültige Quell-URL.' });
      return;
    }

    const updated: StreamSource = {
      ...existing,
      name:
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : existing.name,
      url: nextUrl,
      targetPlaylistId:
        typeof body.targetPlaylistId === 'string' && body.targetPlaylistId.trim()
          ? body.targetPlaylistId.trim()
          : existing.targetPlaylistId,
      targetPlaylistName:
        typeof body.targetPlaylistName === 'string' && body.targetPlaylistName.trim()
          ? body.targetPlaylistName.trim()
          : existing.targetPlaylistName,
      autoRefresh:
        body.autoRefresh !== undefined
          ? Boolean(body.autoRefresh)
          : existing.autoRefresh,
      intervalMinutes:
        body.intervalMinutes !== undefined
          ? Math.max(1, Math.min(1440, Number(body.intervalMinutes) || 15))
          : existing.intervalMinutes,
      enabled:
        body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled,
      defaultIp:
        typeof body.defaultIp === 'string' && isValidIPv4(body.defaultIp)
          ? body.defaultIp.trim()
          : existing.defaultIp,
      startPort:
        body.startPort !== undefined && isValidPort(Number(body.startPort))
          ? Number(body.startPort)
          : existing.startPort,
      updatedAt: new Date().toISOString(),
    };

    const nextSources = [...sources];
    nextSources[idx] = updated;
    store.streamSources = nextSources;
    saveStore(store);
    res.json({ source: updated, store });
  });

  app.delete('/api/sources/:id', (req, res) => {
    const sources = store.streamSources ?? [];
    if (!sources.some((s) => s.id === req.params.id)) {
      res.status(404).json({ error: 'Quelle nicht gefunden.' });
      return;
    }
    store.streamSources = sources.filter((s) => s.id !== req.params.id);
    saveStore(store);
    res.json({ store });
  });

  app.post('/api/sources/sync-all', async (_req, res) => {
    const sources = (store.streamSources ?? []).filter((s) => s.enabled);
    const logs: SourceSyncLogItem[] = [];
    for (const s of sources) {
      const result = await runServerSourceSync(s.id);
      logs.push(result.logEntry);
    }
    res.json({ logs, store });
  });

  app.post('/api/sources/:id/sync', async (req, res) => {
    const exists = (store.streamSources ?? []).some((s) => s.id === req.params.id);
    if (!exists) {
      res.status(404).json({ error: 'Quelle nicht gefunden.' });
      return;
    }
    const result = await runServerSourceSync(req.params.id);
    res.json({ source: result.source, logEntry: result.logEntry, store });
  });

  app.post('/api/ai/chat', async (req, res) => {
    const body = req.body ?? {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'Bitte eine Nachricht eingeben.' });
      return;
    }

    const taskMode: ChatTaskMode =
      body.taskMode === 'fast' ||
      body.taskMode === 'search' ||
      body.taskMode === 'interactive' ||
      body.taskMode === 'reasoning' ||
      body.taskMode === 'auto'
        ? body.taskMode
        : 'auto';

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (m: unknown): m is { role: 'user' | 'assistant'; text: string } =>
              Boolean(m) &&
              typeof m === 'object' &&
              ((m as { role?: string }).role === 'user' ||
                (m as { role?: string }).role === 'assistant') &&
              typeof (m as { text?: string }).text === 'string'
          )
          .slice(-16)
      : [];

    const channels = Array.isArray(body.channels)
      ? (body.channels as Channel[])
      : store.channels;
    const playlists = Array.isArray(body.playlists)
      ? (body.playlists as Playlist[])
      : store.playlists;
    const conflicts = detectEndpointConflicts(channels);

    try {
      const result = await runAiChatTurn({
        message,
        history,
        taskMode,
        forceSearch: Boolean(body.forceSearch),
        channels,
        playlists,
        conflicts,
      });
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/ai/search', async (req, res) => {
    const body = req.body ?? {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Bitte einen Suchbegriff eingeben.' });
      return;
    }
    const providerFocus =
      typeof body.providerFocus === 'string' && body.providerFocus.trim()
        ? body.providerFocus.trim()
        : undefined;

    try {
      const result = await runLiveSearchGrounding({ query, providerFocus });
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/ai/recommend-playlist', async (req, res) => {
    const body = req.body ?? {};
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      res
        .status(400)
        .json({ error: 'Bitte beschreibe kurz deine gewünschte Playlist.' });
      return;
    }
    const channels = Array.isArray(body.channels)
      ? (body.channels as Channel[])
      : store.channels;

    try {
      const result = await runPlaylistRecommendation({ goal, channels });
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiApiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const runDueAutoSyncs = async () => {
    const dueSources = (store.streamSources ?? []).filter((s) =>
      isSourceDueForSync(s)
    );
    for (const src of dueSources) {
      await runServerSourceSync(src.id);
    }
  };

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StreamGrid DE Server läuft auf http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      runDueAutoSyncs().catch(() => {});
    }, 1500);
    setInterval(() => {
      runDueAutoSyncs().catch(() => {});
    }, 30_000);
  });
}

startServer();
