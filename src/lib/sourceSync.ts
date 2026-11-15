import {
  intToIp,
  ipToInt,
  isValidIPv4,
  isValidPort,
  isValidUpstreamUrl,
  normalizePath,
  slugifyChannelName,
} from './ipUtils';
import { ParsedM3UEntry } from './m3u';
import { Channel, Playlist, StreamProtocol, StreamSource } from './types';

export function isValidSourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 500 || /[\s\r\n]/.test(trimmed)) return false;
  if (
    !trimmed.includes('..') &&
    /^\/api\/feeds\/[a-zA-Z0-9_-]+(\.[a-zA-Z0-9]+)?$/.test(trimmed)
  ) {
    return true;
  }
  return isValidUpstreamUrl(trimmed);
}

export function isSourceDueForSync(
  source: StreamSource,
  nowMs: number = Date.now()
): boolean {
  if (!source.enabled || !source.autoRefresh) return false;
  if (!source.lastSyncedAt) return true;
  const lastMs = Date.parse(source.lastSyncedAt);
  if (!Number.isFinite(lastMs)) return true;
  const intervalMs = Math.max(1, Number(source.intervalMinutes) || 15) * 60_000;
  return nowMs - lastMs >= intervalMs;
}

function makeEndpointKey(
  protocol: StreamProtocol,
  ip: string,
  port: number,
  path: string
): string {
  return `${protocol}://${ip.trim()}:${port}${normalizePath(path, protocol)}`;
}

export function allocateConflictFreeEndpoint(
  usedKeys: Set<string>,
  preferredIp: string,
  preferredPort: number,
  protocol: StreamProtocol,
  path: string,
  fallbackIp: string,
  fallbackStartPort: number
): { ip: string; port: number } {
  const baseIp = isValidIPv4(preferredIp)
    ? preferredIp.trim()
    : isValidIPv4(fallbackIp)
      ? fallbackIp.trim()
      : '192.168.178.120';
  const startPort = isValidPort(preferredPort)
    ? preferredPort
    : isValidPort(fallbackStartPort)
      ? fallbackStartPort
      : 8700;

  // Try preferred IP + incrementing port first
  let candidateIpInt = ipToInt(baseIp);
  let candidatePort = startPort;

  for (let step = 0; step < 2000; step++) {
    const candidateIp = intToIp(candidateIpInt);
    const key = makeEndpointKey(protocol, candidateIp, candidatePort, path);
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return { ip: candidateIp, port: candidatePort };
    }
    if (candidatePort < 65535) {
      candidatePort += 1;
    } else {
      candidateIpInt += 1;
      candidatePort = 8000;
    }
  }

  return { ip: baseIp, port: startPort };
}

function makeUniqueChannelId(
  name: string,
  usedIds: Set<string>
): string {
  const slug = slugifyChannelName(name).slice(0, 32) || 'kanal';
  const baseId = `ch-${slug}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseId}-${i}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  const fallback = `${baseId}-${Date.now().toString(36)}`;
  usedIds.add(fallback);
  return fallback;
}

export interface MergeSourceResult {
  nextChannels: Channel[];
  nextPlaylists: Playlist[];
  targetPlaylist: Playlist;
  addedChannels: Channel[];
  updatedChannels: Channel[];
  newlyLinkedCount: number;
  totalParsed: number;
}

export function mergeParsedEntriesIntoStore(params: {
  entries: ParsedM3UEntry[];
  source: StreamSource;
  channels: Channel[];
  playlists: Playlist[];
  nowIso?: string;
}): MergeSourceResult {
  const now = params.nowIso || new Date().toISOString();
  const nextChannels = params.channels.map((c) => ({ ...c }));
  const nextPlaylists = params.playlists.map((p) => ({
    ...p,
    channelIds: [...p.channelIds],
  }));

  const usedIds = new Set(nextChannels.map((c) => c.id));
  const usedEndpoints = new Set(
    nextChannels.map((c) => makeEndpointKey(c.protocol, c.ip, c.port, c.path))
  );

  // Lookup indexes for intelligent deduplication
  const byUpstreamUrl = new Map<string, number>();
  const byTvgId = new Map<string, number>();
  const byNameAndProvider = new Map<string, number>();

  const reindex = () => {
    byUpstreamUrl.clear();
    byTvgId.clear();
    byNameAndProvider.clear();
    nextChannels.forEach((c, idx) => {
      if (c.upstreamUrl) {
        byUpstreamUrl.set(c.upstreamUrl.trim().toLowerCase(), idx);
      }
      if (c.tvgId && !/^kanal-\d+$/i.test(c.tvgId)) {
        byTvgId.set(c.tvgId.trim().toLowerCase(), idx);
      }
      byNameAndProvider.set(
        `${c.name.trim().toLowerCase()}::${c.provider}`,
        idx
      );
    });
  };
  reindex();

  const addedChannels: Channel[] = [];
  const updatedChannels: Channel[] = [];
  const matchedOrAddedIds: string[] = [];

  for (const entry of params.entries) {
    const cleanName = entry.name.trim();
    if (!cleanName) continue;

    const normUpstream = entry.upstreamUrl?.trim().toLowerCase() || '';
    const normTvgId = (entry.tvgId || '').trim().toLowerCase();
    const normNameProv = `${cleanName.toLowerCase()}::${entry.provider}`;

    let existingIdx: number | undefined;
    if (normUpstream && byUpstreamUrl.has(normUpstream)) {
      existingIdx = byUpstreamUrl.get(normUpstream);
    } else if (normTvgId && byTvgId.has(normTvgId)) {
      existingIdx = byTvgId.get(normTvgId);
    } else if (byNameAndProvider.has(normNameProv)) {
      existingIdx = byNameAndProvider.get(normNameProv);
    }

    const cleanUpstream =
      entry.upstreamUrl && isValidUpstreamUrl(entry.upstreamUrl)
        ? entry.upstreamUrl.trim()
        : undefined;
    const cleanPath = normalizePath(entry.path || '', entry.protocol);

    if (existingIdx !== undefined) {
      const existing = nextChannels[existingIdx];
      let changed = false;
      const updated: Channel = { ...existing };

      if (cleanUpstream && updated.upstreamUrl !== cleanUpstream) {
        updated.upstreamUrl = cleanUpstream;
        changed = true;
      }
      if (entry.category && updated.category !== entry.category.trim()) {
        updated.category = entry.category.trim();
        changed = true;
      }
      if (entry.quality && updated.quality !== entry.quality) {
        updated.quality = entry.quality;
        changed = true;
      }
      // Update explicit non-fallback IP/port if provided in source feed
      if (
        isValidIPv4(entry.ip) &&
        entry.ip !== params.source.defaultIp &&
        isValidPort(entry.port) &&
        (updated.ip !== entry.ip || updated.port !== entry.port)
      ) {
        updated.ip = entry.ip.trim();
        updated.port = Number(entry.port);
        updated.protocol = entry.protocol;
        updated.path = cleanPath;
        changed = true;
      }

      if (changed) {
        updated.updatedAt = now;
        nextChannels[existingIdx] = updated;
        updatedChannels.push(updated);
      }

      matchedOrAddedIds.push(updated.id);
      continue;
    }

    // Create new channel with conflict-free IPv4 endpoint
    const endpoint = allocateConflictFreeEndpoint(
      usedEndpoints,
      entry.ip,
      Number(entry.port),
      entry.protocol,
      cleanPath,
      params.source.defaultIp,
      params.source.startPort
    );

    const newChannel: Channel = {
      id: makeUniqueChannelId(cleanName, usedIds),
      name: cleanName.slice(0, 120),
      provider: entry.provider,
      category: (entry.category?.trim() || 'Auto-Quellen').slice(0, 80),
      language: (entry.language?.trim() || 'Deutsch (DE)').slice(0, 40),
      quality: entry.quality ?? 'Full HD',
      protocol: entry.protocol,
      ip: endpoint.ip,
      port: endpoint.port,
      path: cleanPath.slice(0, 200),
      tvgId: (entry.tvgId?.trim() || slugifyChannelName(cleanName)).slice(0, 120),
      enabled: true,
      ...(cleanUpstream ? { upstreamUrl: cleanUpstream.slice(0, 500) } : {}),
      notes: `Auto-Quelle: ${params.source.name}`.slice(0, 300),
      updatedAt: now,
    };

    nextChannels.unshift(newChannel);
    addedChannels.push(newChannel);
    matchedOrAddedIds.push(newChannel.id);
    reindex();
  }

  // Ensure target playlist exists & automatically enter discovered channels (capped at 200 for Firestore rules)
  const MAX_PLAYLIST_CHANNELS = 200;
  const desiredPlaylistId =
    params.source.targetPlaylistId?.trim() ||
    `pl-${slugifyChannelName(params.source.targetPlaylistName || params.source.name).slice(0, 28)}`;
  const desiredPlaylistName =
    params.source.targetPlaylistName?.trim() ||
    `Auto-Liste: ${params.source.name}`;

  let targetIdx = nextPlaylists.findIndex((p) => p.id === desiredPlaylistId);
  if (targetIdx === -1) {
    targetIdx = nextPlaylists.findIndex(
      (p) => p.name.trim().toLowerCase() === desiredPlaylistName.toLowerCase()
    );
  }

  let targetPlaylist: Playlist;
  let newlyLinkedCount = 0;

  if (targetIdx >= 0) {
    targetPlaylist = nextPlaylists[targetIdx];
    const existingSet = new Set(targetPlaylist.channelIds);
    const remainingCapacity = Math.max(
      0,
      MAX_PLAYLIST_CHANNELS - targetPlaylist.channelIds.length
    );
    const toAppend = Array.from(new Set(matchedOrAddedIds))
      .filter((cid) => !existingSet.has(cid))
      .slice(0, remainingCapacity);
    newlyLinkedCount = toAppend.length;
    if (toAppend.length > 0) {
      targetPlaylist = {
        ...targetPlaylist,
        channelIds: [...targetPlaylist.channelIds, ...toAppend],
        updatedAt: now,
      };
      nextPlaylists[targetIdx] = targetPlaylist;
    }
  } else {
    const uniqueIds = Array.from(new Set(matchedOrAddedIds)).slice(
      0,
      MAX_PLAYLIST_CHANNELS
    );
    newlyLinkedCount = uniqueIds.length;
    targetPlaylist = {
      id: desiredPlaylistId,
      name: desiredPlaylistName,
      description: `Automatisch aktualisierte Kanalliste der Quelle „${params.source.name}“.`,
      channelIds: uniqueIds,
      protocolOverride: 'channel',
      createdAt: now,
      updatedAt: now,
    };
    nextPlaylists.unshift(targetPlaylist);
  }

  return {
    nextChannels,
    nextPlaylists,
    targetPlaylist,
    addedChannels,
    updatedChannels,
    newlyLinkedCount,
    totalParsed: params.entries.length,
  };
}
