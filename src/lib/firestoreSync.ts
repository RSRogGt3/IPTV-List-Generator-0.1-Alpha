import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ChatMessageItem } from './aiRouting';
import { OperationType, db, handleFirestoreError } from './firebase';
import { upgradeStoreWithOnlineCatalog } from './seedData';
import {
  CentralStore,
  Channel,
  IpProfile,
  Playlist,
  StreamSource,
} from './types';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function mapDocToChannel(id: string, data: Record<string, unknown>): Channel {
  return {
    id,
    name: String(data.name ?? ''),
    provider: data.provider as Channel['provider'],
    category: String(data.category ?? 'Allgemein'),
    language: String(data.language ?? 'Deutsch (DE)'),
    quality: (data.quality as Channel['quality']) ?? 'Full HD',
    protocol: (data.protocol as Channel['protocol']) ?? 'http',
    ip: String(data.ip ?? '192.168.178.50'),
    port: Number(data.port ?? 8080),
    path: String(data.path ?? ''),
    tvgId: String(data.tvgId ?? id),
    enabled: data.enabled !== false,
    upstreamUrl:
      typeof data.upstreamUrl === 'string' && data.upstreamUrl
        ? data.upstreamUrl
        : undefined,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    updatedAt: toIsoString(data.updatedAt),
  };
}

function mapDocToPlaylist(id: string, data: Record<string, unknown>): Playlist {
  return {
    id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    channelIds: Array.isArray(data.channelIds) ? (data.channelIds as string[]) : [],
    protocolOverride: (data.protocolOverride as Playlist['protocolOverride']) ?? 'channel',
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function mapDocToIpProfile(id: string, data: Record<string, unknown>): IpProfile {
  return {
    id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    baseIp: String(data.baseIp ?? '192.168.178.50'),
    startPort: Number(data.startPort ?? 8001),
    protocol: (data.protocol as IpProfile['protocol']) ?? 'http',
    mode: (data.mode as IpProfile['mode']) ?? 'increment-port',
    pathPrefix: String(data.pathPrefix ?? '/live'),
  };
}

function mapDocToStreamSource(id: string, data: Record<string, unknown>): StreamSource {
  return {
    id,
    name: String(data.name ?? ''),
    url: String(data.url ?? ''),
    targetPlaylistId: String(data.targetPlaylistId ?? ''),
    targetPlaylistName: String(data.targetPlaylistName ?? ''),
    autoRefresh: data.autoRefresh !== false,
    intervalMinutes: Number(data.intervalMinutes ?? 15),
    enabled: data.enabled !== false,
    defaultIp: String(data.defaultIp ?? '192.168.178.150'),
    startPort: Number(data.startPort ?? 8700),
    lastSyncedAt:
      typeof data.lastSyncedAt === 'string' && data.lastSyncedAt
        ? data.lastSyncedAt
        : undefined,
    lastStatus: (data.lastStatus as StreamSource['lastStatus']) ?? 'idle',
    lastAddedCount:
      typeof data.lastAddedCount === 'number' ? data.lastAddedCount : undefined,
    lastUpdatedCount:
      typeof data.lastUpdatedCount === 'number' ? data.lastUpdatedCount : undefined,
    lastTotalCount:
      typeof data.lastTotalCount === 'number' ? data.lastTotalCount : undefined,
    lastError:
      typeof data.lastError === 'string' && data.lastError
        ? data.lastError
        : undefined,
    updatedAt: toIsoString(data.updatedAt),
  };
}

function cleanSingleLine(val: unknown, maxLen: number, fallback = ''): string {
  const cleaned = String(val ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const effective = cleaned || fallback;
  return effective.slice(0, maxLen);
}

function cleanPath(val: unknown): string {
  const cleaned = String(val ?? '')
    .replace(/[\s\r\n]+/g, '')
    .slice(0, 200);
  if (!cleaned) return '';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`.slice(0, 200);
}

function cleanUpstreamUrl(val: unknown): string | undefined {
  const cleaned = String(val ?? '')
    .replace(/[\s\r\n]+/g, '')
    .slice(0, 500);
  return /^https?:\/\/[^\s\r\n]+$/i.test(cleaned) ? cleaned : undefined;
}

function sanitizeChannelIds(ids: unknown, maxCount = 200): string[] {
  if (!Array.isArray(ids)) return [];
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const item of ids) {
    if (typeof item !== 'string') continue;
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(item) && !seen.has(item)) {
      seen.add(item);
      valid.push(item);
      if (valid.length >= maxCount) break;
    }
  }
  return valid;
}

function buildChannelCreatePayload(uid: string, ch: Channel) {
  const safeUpstream = cleanUpstreamUrl(ch.upstreamUrl);
  const safeNotes = cleanSingleLine(ch.notes, 300);
  return {
    ownerId: uid,
    name: cleanSingleLine(ch.name, 120, 'Unbenannter Kanal'),
    provider: ch.provider,
    category: cleanSingleLine(ch.category, 80, 'Allgemein'),
    language: cleanSingleLine(ch.language, 40, 'Deutsch (DE)'),
    quality: ch.quality,
    protocol: ch.protocol,
    ip: ch.ip,
    port: ch.port,
    path: cleanPath(ch.path),
    tvgId: cleanSingleLine(ch.tvgId, 120, ch.id),
    enabled: ch.enabled,
    ...(safeUpstream ? { upstreamUrl: safeUpstream } : {}),
    ...(safeNotes ? { notes: safeNotes } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export interface WorkspaceUpgradeSummary {
  backfilledUpstreamCount: number;
  addedChannelsCount: number;
  addedPlaylistsCount: number;
  addedSourcesCount: number;
}

export async function ensureUserWorkspaceSeeded(
  uid: string,
  displayName: string | null,
  fallbackStore: CentralStore
): Promise<WorkspaceUpgradeSummary> {
  const userDocRef = doc(db, 'users', uid);
  const channelsPath = `users/${uid}/channels`;
  const summary: WorkspaceUpgradeSummary = {
    backfilledUpstreamCount: 0,
    addedChannelsCount: 0,
    addedPlaylistsCount: 0,
    addedSourcesCount: 0,
  };
  try {
    const existingChannels = await getDocs(collection(db, channelsPath));
    const userSnap = await getDoc(userDocRef);
    const safeDisplayName = (displayName || 'StreamGrid Nutzer').slice(0, 120);

    if (!userSnap.exists()) {
      await setDoc(userDocRef, {
        uid,
        displayName: safeDisplayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (userSnap.data()?.displayName !== safeDisplayName) {
      await updateDoc(userDocRef, {
        displayName: safeDisplayName,
        updatedAt: serverTimestamp(),
      });
    }

    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    if (existingChannels.empty) {
      for (const ch of fallbackStore.channels) {
        const ref = doc(db, `users/${uid}/channels`, ch.id);
        ops.push((b) => b.set(ref, buildChannelCreatePayload(uid, ch)));
      }
      for (const pl of fallbackStore.playlists) {
        const ref = doc(db, `users/${uid}/playlists`, pl.id);
        ops.push((b) =>
          b.set(ref, {
            ownerId: uid,
            name: cleanSingleLine(pl.name, 120, 'Playlist'),
            description: pl.description.slice(0, 400),
            channelIds: sanitizeChannelIds(pl.channelIds, 200),
            protocolOverride: pl.protocolOverride ?? 'channel',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      for (const prof of fallbackStore.ipProfiles) {
        const ref = doc(db, `users/${uid}/ipProfiles`, prof.id);
        ops.push((b) =>
          b.set(ref, {
            ownerId: uid,
            name: prof.name.slice(0, 120),
            description: prof.description.slice(0, 300),
            baseIp: prof.baseIp,
            startPort: prof.startPort,
            protocol: prof.protocol,
            mode: prof.mode,
            pathPrefix: prof.pathPrefix.slice(0, 120),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      for (const src of fallbackStore.streamSources ?? []) {
        const ref = doc(db, `users/${uid}/streamSources`, src.id);
        ops.push((b) => b.set(ref, buildStreamSourcePayload(uid, src, true)));
      }
    } else {
      const [plSnap, profSnap, srcSnap] = await Promise.all([
        getDocs(collection(db, `users/${uid}/playlists`)),
        getDocs(collection(db, `users/${uid}/ipProfiles`)),
        getDocs(collection(db, `users/${uid}/streamSources`)),
      ]);

      const currentChannels = existingChannels.docs.map((d) =>
        mapDocToChannel(d.id, d.data())
      );
      const currentPlaylists = plSnap.docs.map((d) =>
        mapDocToPlaylist(d.id, d.data())
      );
      const currentProfiles = profSnap.docs.map((d) =>
        mapDocToIpProfile(d.id, d.data())
      );
      const currentSources = srcSnap.docs.map((d) =>
        mapDocToStreamSource(d.id, d.data())
      );

      const currentStore: CentralStore = {
        channels: currentChannels,
        playlists: currentPlaylists,
        ipProfiles: currentProfiles,
        streamSources: currentSources,
      };
      const upgraded = upgradeStoreWithOnlineCatalog(currentStore);

      if (upgraded.changed) {
        summary.backfilledUpstreamCount = upgraded.backfilledUpstreamCount;
        summary.addedChannelsCount = upgraded.addedChannelsCount;
        summary.addedPlaylistsCount = upgraded.addedPlaylistsCount;
        summary.addedSourcesCount = upgraded.addedSourcesCount;

        const prevChannelMap = new Map(currentChannels.map((c) => [c.id, c]));
        for (const ch of upgraded.store.channels) {
          const prev = prevChannelMap.get(ch.id);
          if (!prev) {
            const ref = doc(db, `users/${uid}/channels`, ch.id);
            ops.push((b) => b.set(ref, buildChannelCreatePayload(uid, ch)));
          } else {
            const patch: Record<string, unknown> = {};
            if (ch.upstreamUrl && ch.upstreamUrl !== prev.upstreamUrl) {
              patch.upstreamUrl = ch.upstreamUrl.slice(0, 500);
            }
            if (ch.provider !== prev.provider) {
              patch.provider = ch.provider;
            }
            if (Object.keys(patch).length > 0) {
              patch.updatedAt = serverTimestamp();
              const ref = doc(db, `users/${uid}/channels`, ch.id);
              ops.push((b) => b.update(ref, patch));
            }
          }
        }

        const prevPlaylistMap = new Map(currentPlaylists.map((p) => [p.id, p]));
        for (const pl of upgraded.store.playlists) {
          const prev = prevPlaylistMap.get(pl.id);
          const ref = doc(db, `users/${uid}/playlists`, pl.id);
          if (!prev) {
            ops.push((b) =>
              b.set(ref, {
                ownerId: uid,
                name: cleanSingleLine(pl.name, 120, 'Playlist'),
                description: pl.description.slice(0, 400),
                channelIds: sanitizeChannelIds(pl.channelIds, 200),
                protocolOverride: pl.protocolOverride ?? 'channel',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            );
          } else if (pl.channelIds.length !== prev.channelIds.length) {
            ops.push((b) =>
              b.update(ref, {
                channelIds: sanitizeChannelIds(pl.channelIds, 200),
                updatedAt: serverTimestamp(),
              })
            );
          }
        }

        const prevSourceMap = new Map(currentSources.map((s) => [s.id, s]));
        for (const src of upgraded.store.streamSources ?? []) {
          const prev = prevSourceMap.get(src.id);
          const ref = doc(db, `users/${uid}/streamSources`, src.id);
          if (!prev) {
            ops.push((b) => b.set(ref, buildStreamSourcePayload(uid, src, true)));
          } else if (
            src.name !== prev.name ||
            src.lastStatus !== prev.lastStatus
          ) {
            ops.push((b) =>
              b.update(ref, {
                name: src.name.slice(0, 120),
                lastStatus: src.lastStatus ?? 'idle',
                lastSyncedAt: '',
                updatedAt: serverTimestamp(),
              })
            );
          }
        }
      }
    }

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        op(batch);
      }
      await batch.commit();
    }
    return summary;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    return summary;
  }
}

export function subscribeUserWorkspace(
  uid: string,
  callbacks: {
    onChannels: (channels: Channel[]) => void;
    onPlaylists: (playlists: Playlist[]) => void;
    onIpProfiles: (profiles: IpProfile[]) => void;
    onStreamSources: (sources: StreamSource[]) => void;
    onChatMessages: (messages: ChatMessageItem[]) => void;
    onError: (err: Error) => void;
  }
): () => void {
  const chPath = `users/${uid}/channels`;
  const plPath = `users/${uid}/playlists`;
  const profPath = `users/${uid}/ipProfiles`;
  const srcPath = `users/${uid}/streamSources`;
  const chatPath = `users/${uid}/chatMessages`;

  const unsubChannels = onSnapshot(
    query(collection(db, chPath), orderBy('updatedAt', 'desc')),
    (snap) => {
      const list: Channel[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? ''),
          provider: data.provider,
          category: String(data.category ?? 'Allgemein'),
          language: String(data.language ?? 'Deutsch (DE)'),
          quality: data.quality ?? 'Full HD',
          protocol: data.protocol ?? 'http',
          ip: String(data.ip ?? '192.168.178.50'),
          port: Number(data.port ?? 8080),
          path: String(data.path ?? ''),
          tvgId: String(data.tvgId ?? d.id),
          enabled: data.enabled !== false,
          upstreamUrl: typeof data.upstreamUrl === 'string' && data.upstreamUrl ? data.upstreamUrl : undefined,
          notes: typeof data.notes === 'string' ? data.notes : undefined,
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      callbacks.onChannels(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, chPath);
      } catch (e) {
        callbacks.onError(e as Error);
      }
    }
  );

  const unsubPlaylists = onSnapshot(
    query(collection(db, plPath), orderBy('updatedAt', 'desc')),
    (snap) => {
      const list: Playlist[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? ''),
          description: String(data.description ?? ''),
          channelIds: Array.isArray(data.channelIds) ? data.channelIds : [],
          protocolOverride: data.protocolOverride ?? 'channel',
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      callbacks.onPlaylists(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, plPath);
      } catch (e) {
        callbacks.onError(e as Error);
      }
    }
  );

  const unsubProfiles = onSnapshot(
    query(collection(db, profPath), orderBy('updatedAt', 'desc')),
    (snap) => {
      const list: IpProfile[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? ''),
          description: String(data.description ?? ''),
          baseIp: String(data.baseIp ?? '192.168.178.50'),
          startPort: Number(data.startPort ?? 8001),
          protocol: data.protocol ?? 'http',
          mode: data.mode ?? 'increment-port',
          pathPrefix: String(data.pathPrefix ?? '/live'),
        };
      });
      callbacks.onIpProfiles(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, profPath);
      } catch (e) {
        callbacks.onError(e as Error);
      }
    }
  );

  const unsubChat = onSnapshot(
    query(collection(db, chatPath), orderBy('createdAt', 'asc')),
    (snap) => {
      const list: ChatMessageItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          role: data.role === 'user' ? 'user' : 'assistant',
          text: String(data.text ?? ''),
          model: String(data.model ?? 'gemini-4-hydrogen'),
          taskMode: data.taskMode ?? 'auto',
          sources: Array.isArray(data.sources) ? data.sources : undefined,
          suggestedPlaylist: data.suggestedPlaylist ?? undefined,
          createdAt: toIsoString(data.createdAt),
        };
      });
      callbacks.onChatMessages(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, chatPath);
      } catch (e) {
        callbacks.onError(e as Error);
      }
    }
  );

  const unsubSources = onSnapshot(
    query(collection(db, srcPath), orderBy('updatedAt', 'desc')),
    (snap) => {
      const list: StreamSource[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name ?? ''),
          url: String(data.url ?? ''),
          targetPlaylistId: String(data.targetPlaylistId ?? ''),
          targetPlaylistName: String(data.targetPlaylistName ?? ''),
          autoRefresh: data.autoRefresh !== false,
          intervalMinutes: Number(data.intervalMinutes ?? 15),
          enabled: data.enabled !== false,
          defaultIp: String(data.defaultIp ?? '192.168.178.150'),
          startPort: Number(data.startPort ?? 8700),
          lastSyncedAt:
            typeof data.lastSyncedAt === 'string' && data.lastSyncedAt
              ? data.lastSyncedAt
              : undefined,
          lastStatus: data.lastStatus ?? 'idle',
          lastAddedCount:
            typeof data.lastAddedCount === 'number'
              ? data.lastAddedCount
              : undefined,
          lastUpdatedCount:
            typeof data.lastUpdatedCount === 'number'
              ? data.lastUpdatedCount
              : undefined,
          lastTotalCount:
            typeof data.lastTotalCount === 'number'
              ? data.lastTotalCount
              : undefined,
          lastError:
            typeof data.lastError === 'string' && data.lastError
              ? data.lastError
              : undefined,
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      callbacks.onStreamSources(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, srcPath);
      } catch (e) {
        callbacks.onError(e as Error);
      }
    }
  );

  return () => {
    unsubChannels();
    unsubPlaylists();
    unsubProfiles();
    unsubChat();
    unsubSources();
  };
}

function buildStreamSourcePayload(
  uid: string,
  source: Omit<StreamSource, 'updatedAt'>,
  isNew: boolean
) {
  const safeUrl = source.url.replace(/[\s\r\n]+/g, '').slice(0, 500);
  return {
    ownerId: uid,
    name: cleanSingleLine(source.name, 120, 'Auto-Quelle'),
    url: safeUrl,
    targetPlaylistId: source.targetPlaylistId.slice(0, 128),
    targetPlaylistName: cleanSingleLine(source.targetPlaylistName, 120, 'Auto-Liste'),
    autoRefresh: Boolean(source.autoRefresh),
    intervalMinutes: Math.max(
      1,
      Math.min(1440, Math.round(Number(source.intervalMinutes) || 15))
    ),
    enabled: Boolean(source.enabled),
    defaultIp: source.defaultIp,
    startPort: Math.max(1, Math.min(65535, Math.round(Number(source.startPort) || 8700))),
    ...(source.lastSyncedAt
      ? { lastSyncedAt: source.lastSyncedAt.slice(0, 60) }
      : {}),
    ...(source.lastStatus ? { lastStatus: source.lastStatus } : {}),
    ...(typeof source.lastAddedCount === 'number'
      ? { lastAddedCount: Math.max(0, Math.min(100000, Math.round(source.lastAddedCount))) }
      : {}),
    ...(typeof source.lastUpdatedCount === 'number'
      ? { lastUpdatedCount: Math.max(0, Math.min(100000, Math.round(source.lastUpdatedCount))) }
      : {}),
    ...(typeof source.lastTotalCount === 'number'
      ? { lastTotalCount: Math.max(0, Math.min(100000, Math.round(source.lastTotalCount))) }
      : {}),
    lastError: (source.lastError ?? '').slice(0, 400),
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  };
}

export async function saveChannelDoc(
  uid: string,
  channel: Omit<Channel, 'updatedAt'>,
  isNew: boolean
): Promise<void> {
  const path = `users/${uid}/channels/${channel.id}`;
  try {
    const safeUpstream = cleanUpstreamUrl(channel.upstreamUrl) ?? '';
    const payload = {
      ownerId: uid,
      name: cleanSingleLine(channel.name, 120, 'Unbenannter Kanal'),
      provider: channel.provider,
      category: cleanSingleLine(channel.category, 80, 'Allgemein'),
      language: cleanSingleLine(channel.language, 40, 'Deutsch (DE)'),
      quality: channel.quality,
      protocol: channel.protocol,
      ip: channel.ip,
      port: channel.port,
      path: cleanPath(channel.path),
      tvgId: cleanSingleLine(channel.tvgId, 120, channel.id),
      enabled: channel.enabled,
      upstreamUrl: safeUpstream,
      notes: cleanSingleLine(channel.notes, 300),
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, `users/${uid}/channels`, channel.id), payload, {
      merge: !isNew,
    });
  } catch (error) {
    handleFirestoreError(
      error,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      path
    );
  }
}

export async function deleteChannelDoc(uid: string, channelId: string): Promise<void> {
  const path = `users/${uid}/channels/${channelId}`;
  try {
    await deleteDoc(doc(db, `users/${uid}/channels`, channelId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchUpdateChannelsDocs(
  uid: string,
  channels: Channel[]
): Promise<void> {
  const path = `users/${uid}/channels`;
  try {
    for (let i = 0; i < channels.length; i += 400) {
      const batch = writeBatch(db);
      for (const ch of channels.slice(i, i + 400)) {
        const safeUpstream = cleanUpstreamUrl(ch.upstreamUrl);
        const safeNotes = cleanSingleLine(ch.notes, 300);
        batch.set(
          doc(db, path, ch.id),
          {
            ownerId: uid,
            name: cleanSingleLine(ch.name, 120, 'Unbenannter Kanal'),
            provider: ch.provider,
            category: cleanSingleLine(ch.category, 80, 'Allgemein'),
            language: cleanSingleLine(ch.language, 40, 'Deutsch (DE)'),
            quality: ch.quality,
            protocol: ch.protocol,
            ip: ch.ip,
            port: ch.port,
            path: cleanPath(ch.path),
            tvgId: cleanSingleLine(ch.tvgId, 120, ch.id),
            enabled: ch.enabled,
            ...(safeUpstream ? { upstreamUrl: safeUpstream } : {}),
            ...(safeNotes ? { notes: safeNotes } : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function savePlaylistDoc(
  uid: string,
  playlist: Pick<
    Playlist,
    'id' | 'name' | 'description' | 'channelIds' | 'protocolOverride'
  >,
  isNew: boolean
): Promise<void> {
  const path = `users/${uid}/playlists/${playlist.id}`;
  try {
    await setDoc(
      doc(db, `users/${uid}/playlists`, playlist.id),
      {
        ownerId: uid,
        name: cleanSingleLine(playlist.name, 120, 'Playlist'),
        description: playlist.description.slice(0, 400),
        channelIds: sanitizeChannelIds(playlist.channelIds, 200),
        protocolOverride: playlist.protocolOverride ?? 'channel',
        ...(isNew ? { createdAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: !isNew }
    );
  } catch (error) {
    handleFirestoreError(
      error,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      path
    );
  }
}

export async function deletePlaylistDoc(
  uid: string,
  playlistId: string
): Promise<void> {
  const path = `users/${uid}/playlists/${playlistId}`;
  try {
    await deleteDoc(doc(db, `users/${uid}/playlists`, playlistId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveIpProfileDoc(
  uid: string,
  profile: IpProfile
): Promise<void> {
  const path = `users/${uid}/ipProfiles/${profile.id}`;
  try {
    await setDoc(doc(db, `users/${uid}/ipProfiles`, profile.id), {
      ownerId: uid,
      name: profile.name.slice(0, 120),
      description: profile.description.slice(0, 300),
      baseIp: profile.baseIp,
      startPort: profile.startPort,
      protocol: profile.protocol,
      mode: profile.mode,
      pathPrefix: profile.pathPrefix.slice(0, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteIpProfileDoc(
  uid: string,
  profileId: string
): Promise<void> {
  const path = `users/${uid}/ipProfiles/${profileId}`;
  try {
    await deleteDoc(doc(db, `users/${uid}/ipProfiles`, profileId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveChatMessageDoc(
  uid: string,
  msg: Omit<ChatMessageItem, 'createdAt'>
): Promise<void> {
  const path = `users/${uid}/chatMessages/${msg.id}`;
  const sanitizedSources = (msg.sources ?? [])
    .filter((s) => typeof s?.uri === 'string' && /^https?:\/\//i.test(s.uri.trim()))
    .slice(0, 20)
    .map((s) => ({
      title: String(s.title || 'Quelle').slice(0, 200),
      uri: s.uri.trim().slice(0, 1000),
    }));

  try {
    await setDoc(doc(db, `users/${uid}/chatMessages`, msg.id), {
      ownerId: uid,
      role: msg.role,
      text: msg.text.slice(0, 20000),
      model: msg.model.slice(0, 80),
      taskMode: msg.taskMode,
      ...(sanitizedSources.length > 0 ? { sources: sanitizedSources } : {}),
      ...(msg.suggestedPlaylist
        ? {
            suggestedPlaylist: {
              name: cleanSingleLine(msg.suggestedPlaylist.name, 120, 'Playlist'),
              description: msg.suggestedPlaylist.description.slice(0, 400),
              channelIds: sanitizeChannelIds(msg.suggestedPlaylist.channelIds, 50),
            },
          }
        : {}),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearChatMessagesDocs(
  uid: string,
  messageIds: string[]
): Promise<void> {
  const path = `users/${uid}/chatMessages`;
  try {
    for (let i = 0; i < messageIds.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of messageIds.slice(i, i + 400)) {
        batch.delete(doc(db, path, id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveStreamSourceDoc(
  uid: string,
  source: Omit<StreamSource, 'updatedAt'>,
  isNew: boolean
): Promise<void> {
  const path = `users/${uid}/streamSources/${source.id}`;
  try {
    await setDoc(
      doc(db, `users/${uid}/streamSources`, source.id),
      buildStreamSourcePayload(uid, source, isNew),
      { merge: !isNew }
    );
  } catch (error) {
    handleFirestoreError(
      error,
      isNew ? OperationType.CREATE : OperationType.UPDATE,
      path
    );
  }
}

export async function deleteStreamSourceDoc(
  uid: string,
  sourceId: string
): Promise<void> {
  const path = `users/${uid}/streamSources/${sourceId}`;
  try {
    await deleteDoc(doc(db, `users/${uid}/streamSources`, sourceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchApplySourceSyncDocs(
  uid: string,
  params: {
    addedChannels: Channel[];
    updatedChannels: Channel[];
    targetPlaylist: Playlist;
    isNewPlaylist: boolean;
    source: StreamSource;
  }
): Promise<void> {
  const rootPath = `users/${uid}`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    for (const ch of params.addedChannels) {
      const ref = doc(db, `${rootPath}/channels`, ch.id);
      ops.push((b) => b.set(ref, buildChannelCreatePayload(uid, ch)));
    }

    for (const ch of params.updatedChannels) {
      const ref = doc(db, `${rootPath}/channels`, ch.id);
      const safeUpstream = cleanUpstreamUrl(ch.upstreamUrl);
      const safeNotes = cleanSingleLine(ch.notes, 300);
      ops.push((b) =>
        b.set(
          ref,
          {
            ownerId: uid,
            name: cleanSingleLine(ch.name, 120, 'Unbenannter Kanal'),
            provider: ch.provider,
            category: cleanSingleLine(ch.category, 80, 'Allgemein'),
            language: cleanSingleLine(ch.language, 40, 'Deutsch (DE)'),
            quality: ch.quality,
            protocol: ch.protocol,
            ip: ch.ip,
            port: ch.port,
            path: cleanPath(ch.path),
            tvgId: cleanSingleLine(ch.tvgId, 120, ch.id),
            enabled: ch.enabled,
            ...(safeUpstream ? { upstreamUrl: safeUpstream } : {}),
            ...(safeNotes ? { notes: safeNotes } : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );
    }

    const plRef = doc(db, `${rootPath}/playlists`, params.targetPlaylist.id);
    ops.push((b) =>
      b.set(
        plRef,
        {
          ownerId: uid,
          name: cleanSingleLine(params.targetPlaylist.name, 120, 'Playlist'),
          description: params.targetPlaylist.description.slice(0, 400),
          channelIds: sanitizeChannelIds(params.targetPlaylist.channelIds, 200),
          protocolOverride: params.targetPlaylist.protocolOverride ?? 'channel',
          ...(params.isNewPlaylist ? { createdAt: serverTimestamp() } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: !params.isNewPlaylist }
      )
    );

    const srcRef = doc(db, `${rootPath}/streamSources`, params.source.id);
    ops.push((b) =>
      b.set(srcRef, buildStreamSourcePayload(uid, params.source, false), {
        merge: true,
      })
    );

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        op(batch);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, rootPath);
  }
}

export async function replaceUserWorkspaceDocs(
  uid: string,
  nextStore: CentralStore
): Promise<void> {
  const rootPath = `users/${uid}`;
  try {
    const [chSnap, plSnap, profSnap, srcSnap] = await Promise.all([
      getDocs(collection(db, `${rootPath}/channels`)),
      getDocs(collection(db, `${rootPath}/playlists`)),
      getDocs(collection(db, `${rootPath}/ipProfiles`)),
      getDocs(collection(db, `${rootPath}/streamSources`)),
    ]);

    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    for (const d of chSnap.docs) {
      ops.push((b) => b.delete(d.ref));
    }
    for (const d of plSnap.docs) {
      ops.push((b) => b.delete(d.ref));
    }
    for (const d of profSnap.docs) {
      ops.push((b) => b.delete(d.ref));
    }
    for (const d of srcSnap.docs) {
      ops.push((b) => b.delete(d.ref));
    }

    for (const ch of nextStore.channels) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ch.id)) continue;
      const ref = doc(db, `${rootPath}/channels`, ch.id);
      ops.push((b) => b.set(ref, buildChannelCreatePayload(uid, ch)));
    }

    for (const pl of nextStore.playlists) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(pl.id)) continue;
      const ref = doc(db, `${rootPath}/playlists`, pl.id);
      ops.push((b) =>
        b.set(ref, {
          ownerId: uid,
          name: cleanSingleLine(pl.name, 120, 'Playlist'),
          description: pl.description.slice(0, 400),
          channelIds: sanitizeChannelIds(pl.channelIds, 200),
          protocolOverride: pl.protocolOverride ?? 'channel',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    for (const prof of nextStore.ipProfiles) {
      const ref = doc(db, `${rootPath}/ipProfiles`, prof.id);
      ops.push((b) =>
        b.set(ref, {
          ownerId: uid,
          name: prof.name.slice(0, 120),
          description: prof.description.slice(0, 300),
          baseIp: prof.baseIp,
          startPort: prof.startPort,
          protocol: prof.protocol,
          mode: prof.mode,
          pathPrefix: prof.pathPrefix.slice(0, 120),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    for (const src of nextStore.streamSources ?? []) {
      const ref = doc(db, `${rootPath}/streamSources`, src.id);
      ops.push((b) => b.set(ref, buildStreamSourcePayload(uid, src, true)));
    }

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        op(batch);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, rootPath);
  }
}
