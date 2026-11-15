import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { CheckCircle2, X } from 'lucide-react';
import { AiAssistantView } from './components/AiAssistantView';
import { ChannelDirectory } from './components/ChannelDirectory';
import { ChannelModal } from './components/ChannelModal';
import { ImportExportView } from './components/ImportExportView';
import { IpGeneratorView } from './components/IpGeneratorView';
import { LinkPlaylistModal } from './components/LinkPlaylistModal';
import { PlaylistModal } from './components/PlaylistModal';
import { PlaylistWorkspace } from './components/PlaylistWorkspace';
import { NavView, Sidebar } from './components/Sidebar';
import { SourcesSyncView } from './components/SourcesSyncView';
import { TestPlayerModal } from './components/TestPlayerModal';
import { TopBar } from './components/TopBar';
import {
  ChatMessageItem,
  ChatTaskMode,
  SuggestedPlaylist,
} from './lib/aiRouting';
import { api } from './lib/api';
import { auth, googleAuthProvider } from './lib/firebase';
import {
  batchApplySourceSyncDocs,
  batchUpdateChannelsDocs,
  clearChatMessagesDocs,
  deleteChannelDoc,
  deleteIpProfileDoc,
  deletePlaylistDoc,
  deleteStreamSourceDoc,
  ensureUserWorkspaceSeeded,
  replaceUserWorkspaceDocs,
  saveChannelDoc,
  saveChatMessageDoc,
  saveIpProfileDoc,
  savePlaylistDoc,
  saveStreamSourceDoc,
  subscribeUserWorkspace,
} from './lib/firestoreSync';
import {
  detectEndpointConflicts,
  generateIpAssignments,
  isValidIPv4,
  isValidPort,
  isValidUpstreamUrl,
  normalizePath,
  slugifyChannelName,
} from './lib/ipUtils';
import { ParsedM3UEntry } from './lib/m3u';
import { createInitialStore } from './lib/seedData';
import {
  isSourceDueForSync,
  mergeParsedEntriesIntoStore,
} from './lib/sourceSync';
import { useEndpointReachability } from './lib/useEndpointReachability';
import {
  CentralStore,
  Channel,
  IpGenerationConfig,
  IpProfile,
  Playlist,
  SourceSyncLogItem,
  StreamProtocol,
  StreamSource,
} from './lib/types';

function makeClientId(prefix: string, name: string): string {
  const slug = slugifyChannelName(name).slice(0, 28) || 'item';
  const rand =
    Math.random()
      .toString(36)
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 6) || 'x1y2';
  return `${prefix}-${slug}-${rand}`;
}

export default function App() {
  const [store, setStore] = useState<CentralStore>({
    channels: [],
    playlists: [],
    ipProfiles: [],
    streamSources: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<SourceSyncLogItem[]>([]);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);

  // Firebase Auth & Cloud Sync state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Multi-turn AI chatbot history
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);

  const [activeView, setActiveView] = useState<NavView>('channels');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Modals
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);

  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);

  const [linkModalChannelIds, setLinkModalChannelIds] = useState<
    string[] | null
  >(null);
  const [ipGenPreselection, setIpGenPreselection] = useState<string[]>([]);
  const [playerModal, setPlayerModal] = useState<{
    open: boolean;
    scope: 'all' | 'playlist';
    playlistChannels: Channel[];
    initialChannelId: string | null;
    contextTitle?: string;
  }>({
    open: false,
    scope: 'all',
    playlistChannels: [],
    initialChannelId: null,
  });

  const [toast, setToast] = useState<string | null>(null);
  const storeRef = useRef<CentralStore>(store);
  storeRef.current = store;

  const {
    reachabilityById,
    checkingReachability,
    lastReachabilityAt,
    intervalMs: reachabilityIntervalMs,
    setIntervalMs: setReachabilityIntervalMs,
    checkReachabilityNow,
  } = useEndpointReachability(store.channels, loading);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 3400);
  }, []);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const fetchStore = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getStore();
      setStore(data);
      setSelectedPlaylistId((prev) =>
        prev && data.playlists.some((p) => p.id === prev)
          ? prev
          : data.playlists[0]?.id ?? null
      );
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Verbindung zur Zentrale fehlgeschlagen.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubWorkspace: (() => void) | null = null;
    let active = true;

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;

      if (unsubWorkspace) {
        unsubWorkspace();
        unsubWorkspace = null;
      }

      setUser(nextUser);

      if (!nextUser) {
        setChatMessages([]);
        await fetchStore();
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        let seedSource = storeRef.current;
        if (seedSource.channels.length === 0) {
          try {
            seedSource = await api.getStore();
          } catch {
            seedSource = createInitialStore();
          }
        }

        const upgradeSummary = await ensureUserWorkspaceSeeded(
          nextUser.uid,
          nextUser.displayName,
          seedSource
        );

        if (!active) return;

        const upgradeParts: string[] = [];
        if (upgradeSummary.backfilledUpstreamCount > 0) {
          upgradeParts.push(
            `${upgradeSummary.backfilledUpstreamCount} Online-URLs ergänzt`
          );
        }
        if (upgradeSummary.addedChannelsCount > 0) {
          upgradeParts.push(
            `+${upgradeSummary.addedChannelsCount} neue DACH/Online-Sender`
          );
        }
        if (upgradeSummary.addedPlaylistsCount > 0) {
          upgradeParts.push(
            `+${upgradeSummary.addedPlaylistsCount} Playlists`
          );
        }
        if (upgradeSummary.addedSourcesCount > 0) {
          upgradeParts.push(
            `+${upgradeSummary.addedSourcesCount} Auto-Quellen`
          );
        }
        if (upgradeParts.length > 0) {
          notifyRef.current(`Cloud-Sync aktualisiert: ${upgradeParts.join(' · ')}.`);
        }

        unsubWorkspace = subscribeUserWorkspace(nextUser.uid, {
          onChannels: (channels) => {
            setStore((prev) => ({ ...prev, channels }));
            setLoading(false);
          },
          onPlaylists: (playlists) => {
            setStore((prev) => ({ ...prev, playlists }));
            setSelectedPlaylistId((prev) =>
              prev && playlists.some((p) => p.id === prev)
                ? prev
                : playlists[0]?.id ?? null
            );
          },
          onIpProfiles: (ipProfiles) => {
            setStore((prev) => ({ ...prev, ipProfiles }));
          },
          onStreamSources: (streamSources) => {
            setStore((prev) => ({ ...prev, streamSources }));
          },
          onChatMessages: (msgs) => {
            setChatMessages(msgs);
          },
          onError: (err) => {
            setLoadError(
              err instanceof Error
                ? `Cloud-Sync Fehler: ${err.message}`
                : 'Cloud-Sync fehlgeschlagen.'
            );
            setLoading(false);
          },
        });
      } catch (err) {
        if (!active) return;
        setLoadError(
          err instanceof Error
            ? `Cloud-Workspace konnte nicht geladen werden: ${err.message}`
            : 'Cloud-Workspace Fehler.'
        );
        setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubAuth();
      if (unsubWorkspace) unsubWorkspace();
    };
  }, [fetchStore]);

  useEffect(() => {
    if (!user) return;
    if (store.channels.length === 0 && store.playlists.length === 0) return;

    const timer = window.setTimeout(() => {
      api
        .syncWorkspace({
          uid: user.uid,
          channels: store.channels,
          playlists: store.playlists,
        })
        .catch(() => {
          // Live M3U mirror sync failure should not block UI editing
        });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [user, store.channels, store.playlists]);

  const handleSignIn = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      notify('Mit Google Cloud-Sync verbunden.');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/popup-closed-by-user') {
        notify(
          err instanceof Error
            ? `Anmeldung fehlgeschlagen: ${err.message}`
            : 'Google-Anmeldung fehlgeschlagen.'
        );
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      notify('Cloud-Sync abgemeldet. Lokaler Modus aktiv.');
    } catch (err) {
      notify(
        err instanceof Error
          ? `Abmeldung fehlgeschlagen: ${err.message}`
          : 'Abmeldung fehlgeschlagen.'
      );
    }
  };

  const conflicts = useMemo(
    () => detectEndpointConflicts(store.channels),
    [store.channels]
  );

  const selectedPlaylistName = useMemo(
    () => store.playlists.find((p) => p.id === selectedPlaylistId)?.name,
    [store.playlists, selectedPlaylistId]
  );

  const handleSaveChannel = async (
    payload: Omit<Channel, 'id' | 'updatedAt'> & { playlistIds: string[] },
    existingId?: string
  ) => {
    if (user) {
      const id = existingId || makeClientId('ch', payload.name);
      const cleanPath = normalizePath(payload.path, payload.protocol);
      const trimmedUpstream = payload.upstreamUrl?.trim() || '';
      const cleanChannel: Omit<Channel, 'updatedAt'> = {
        id,
        name: payload.name.trim(),
        provider: payload.provider,
        category: payload.category.trim() || 'Allgemein',
        language: payload.language.trim() || 'Deutsch (DE)',
        quality: payload.quality,
        protocol: payload.protocol,
        ip: payload.ip.trim(),
        port: Number(payload.port),
        path: cleanPath,
        tvgId: payload.tvgId.trim() || slugifyChannelName(payload.name),
        enabled: payload.enabled,
        upstreamUrl:
          trimmedUpstream && isValidUpstreamUrl(trimmedUpstream)
            ? trimmedUpstream
            : undefined,
        notes: payload.notes?.trim() || undefined,
      };
      await saveChannelDoc(user.uid, cleanChannel, !existingId);

      const targetSet = new Set(payload.playlistIds);
      for (const pl of store.playlists) {
        const hasChannel = pl.channelIds.includes(id);
        if (targetSet.has(pl.id) && !hasChannel) {
          await savePlaylistDoc(
            user.uid,
            { ...pl, channelIds: [...pl.channelIds, id].slice(0, 200) },
            false
          );
        } else if (existingId && !targetSet.has(pl.id) && hasChannel) {
          await savePlaylistDoc(
            user.uid,
            {
              ...pl,
              channelIds: pl.channelIds.filter((cid) => cid !== id),
            },
            false
          );
        }
      }

      notify(
        existingId
          ? `Kanal "${cleanChannel.name}" aktualisiert.`
          : `Kanal "${cleanChannel.name}" mit IP ${cleanChannel.ip}:${cleanChannel.port} erstellt.`
      );
      return;
    }

    if (existingId) {
      const res = await api.updateChannel(existingId, payload);
      setStore(res.store);
      notify(`Kanal "${res.channel.name}" aktualisiert.`);
    } else {
      const res = await api.createChannel(payload);
      setStore(res.store);
      notify(
        `Kanal "${res.channel.name}" mit IP ${res.channel.ip}:${res.channel.port} erstellt.`
      );
    }
  };

  const handleDeleteChannel = async (channel: Channel) => {
    if (user) {
      await deleteChannelDoc(user.uid, channel.id);
      for (const pl of store.playlists) {
        if (pl.channelIds.includes(channel.id)) {
          await savePlaylistDoc(
            user.uid,
            {
              ...pl,
              channelIds: pl.channelIds.filter((cid) => cid !== channel.id),
            },
            false
          );
        }
      }
      notify(`Kanal "${channel.name}" entfernt.`);
      return;
    }

    const res = await api.deleteChannel(channel.id);
    setStore(res.store);
    notify(`Kanal "${channel.name}" entfernt.`);
  };

  const handleToggleEnabled = async (channel: Channel) => {
    if (user) {
      await saveChannelDoc(
        user.uid,
        { ...channel, enabled: !channel.enabled },
        false
      );
      return;
    }

    const res = await api.updateChannel(channel.id, {
      enabled: !channel.enabled,
    });
    setStore(res.store);
  };

  const handleSavePlaylist = async (
    payload: {
      name: string;
      description: string;
      protocolOverride: StreamProtocol | 'channel';
    },
    existingId?: string
  ) => {
    if (user) {
      if (existingId) {
        const existing = store.playlists.find((p) => p.id === existingId);
        await savePlaylistDoc(
          user.uid,
          {
            id: existingId,
            name: payload.name.trim(),
            description: payload.description.trim(),
            channelIds: existing?.channelIds ?? [],
            protocolOverride: payload.protocolOverride,
          },
          false
        );
        notify(`Playlist "${payload.name.trim()}" gespeichert.`);
      } else {
        const newId = makeClientId('pl', payload.name);
        await savePlaylistDoc(
          user.uid,
          {
            id: newId,
            name: payload.name.trim(),
            description: payload.description.trim(),
            channelIds: [],
            protocolOverride: payload.protocolOverride,
          },
          true
        );
        setSelectedPlaylistId(newId);
        setActiveView('playlists');
        notify(`Playlist "${payload.name.trim()}" erstellt.`);
      }
      return;
    }

    if (existingId) {
      const res = await api.updatePlaylist(existingId, payload);
      setStore(res.store);
      notify(`Playlist "${res.playlist.name}" gespeichert.`);
    } else {
      const res = await api.createPlaylist(payload);
      setStore(res.store);
      setSelectedPlaylistId(res.playlist.id);
      setActiveView('playlists');
      notify(`Playlist "${res.playlist.name}" erstellt.`);
    }
  };

  const handleDeletePlaylist = async (playlist: Playlist) => {
    if (user) {
      await deletePlaylistDoc(user.uid, playlist.id);
      const remaining = store.playlists.filter((p) => p.id !== playlist.id);
      setSelectedPlaylistId(remaining[0]?.id ?? null);
      notify(`Playlist "${playlist.name}" gelöscht.`);
      return;
    }

    const res = await api.deletePlaylist(playlist.id);
    setStore(res.store);
    setSelectedPlaylistId(res.store.playlists[0]?.id ?? null);
    notify(`Playlist "${playlist.name}" gelöscht.`);
  };

  const handleLinkToExisting = async (
    playlistId: string,
    channelIds: string[]
  ) => {
    if (user) {
      const pl = store.playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      const mergedIds = Array.from(
        new Set([...pl.channelIds, ...channelIds])
      ).slice(0, 200);
      await savePlaylistDoc(
        user.uid,
        { ...pl, channelIds: mergedIds },
        false
      );
      notify(`${channelIds.length} Kanal/Kanäle mit "${pl.name}" verknüpft.`);
      return;
    }

    const res = await api.linkChannelsToPlaylist(playlistId, channelIds);
    setStore(res.store);
    notify(
      `${channelIds.length} Kanal/Kanäle mit "${res.playlist.name}" verknüpft.`
    );
  };

  const handleCreateAndLink = async (name: string, channelIds: string[]) => {
    if (user) {
      const newId = makeClientId('pl', name);
      await savePlaylistDoc(
        user.uid,
        {
          id: newId,
          name: name.trim(),
          description: '',
          channelIds: Array.from(new Set(channelIds)).slice(0, 200),
          protocolOverride: 'channel',
        },
        true
      );
      setSelectedPlaylistId(newId);
      notify(`Playlist "${name.trim()}" erstellt und verknüpft.`);
      return;
    }

    const res = await api.createPlaylist({
      name,
      description: '',
      channelIds,
      protocolOverride: 'channel',
    });
    setStore(res.store);
    setSelectedPlaylistId(res.playlist.id);
    notify(`Playlist "${res.playlist.name}" erstellt und verknüpft.`);
  };

  const handleReorderChannels = async (
    playlistId: string,
    newChannelIds: string[]
  ) => {
    if (user) {
      const pl = store.playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      await savePlaylistDoc(
        user.uid,
        { ...pl, channelIds: newChannelIds },
        false
      );
      return;
    }

    const res = await api.updatePlaylist(playlistId, {
      channelIds: newChannelIds,
    });
    setStore(res.store);
  };

  const handleAddChannelsToPlaylist = async (
    playlistId: string,
    channelIds: string[]
  ) => {
    if (user) {
      const pl = store.playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      const mergedIds = Array.from(
        new Set([...pl.channelIds, ...channelIds])
      ).slice(0, 200);
      await savePlaylistDoc(
        user.uid,
        { ...pl, channelIds: mergedIds },
        false
      );
      notify(`Kanal zur Playlist "${pl.name}" hinzugefügt.`);
      return;
    }

    const res = await api.linkChannelsToPlaylist(playlistId, channelIds);
    setStore(res.store);
    notify(`Kanal zur Playlist "${res.playlist.name}" hinzugefügt.`);
  };

  const handleRemoveChannelFromPlaylist = async (
    playlistId: string,
    channelId: string
  ) => {
    if (user) {
      const pl = store.playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      await savePlaylistDoc(
        user.uid,
        {
          ...pl,
          channelIds: pl.channelIds.filter((cid) => cid !== channelId),
        },
        false
      );
      notify('Kanal aus Playlist gelöst.');
      return;
    }

    const res = await api.unlinkChannelFromPlaylist(playlistId, channelId);
    setStore(res.store);
    notify('Kanal aus Playlist gelöst.');
  };

  const handleApplyBulkIp = async (
    channelIds: string[],
    config: IpGenerationConfig
  ) => {
    if (user) {
      const idSet = new Set(channelIds);
      const targets = store.channels.filter((c) => idSet.has(c.id));
      const updatedTargets = generateIpAssignments(targets, config);
      await batchUpdateChannelsDocs(user.uid, updatedTargets);
      notify(`IP-Endpunkte für ${updatedTargets.length} Kanäle aktualisiert.`);
      return;
    }

    const res = await api.bulkGenerateIp(channelIds, config);
    setStore(res.store);
    notify(`IP-Endpunkte für ${res.updatedCount} Kanäle aktualisiert.`);
  };

  const handleCreateIpProfile = async (payload: Omit<IpProfile, 'id'>) => {
    if (user) {
      const profile: IpProfile = {
        ...payload,
        id: makeClientId('prof', payload.name),
      };
      await saveIpProfileDoc(user.uid, profile);
      notify(`IP-Profil "${profile.name}" gespeichert.`);
      return;
    }

    const res = await api.createIpProfile(payload);
    setStore(res.store);
    notify(`IP-Profil "${res.profile.name}" gespeichert.`);
  };

  const handleDeleteIpProfile = async (id: string) => {
    if (user) {
      await deleteIpProfileDoc(user.uid, id);
      notify('IP-Profil gelöscht.');
      return;
    }

    const res = await api.deleteIpProfile(id);
    setStore(res.store);
    notify('IP-Profil gelöscht.');
  };

  const handleImportEntries = async (payload: {
    entries: ParsedM3UEntry[];
    targetPlaylistId?: string;
    newPlaylistName?: string;
  }) => {
    if (user) {
      const createdIds: string[] = [];
      for (const entry of payload.entries) {
        const name = entry.name.trim();
        const ip = entry.ip.trim();
        const port = Number(entry.port);
        if (!name || !isValidIPv4(ip) || !isValidPort(port)) continue;

        const id = makeClientId('ch', name);
        await saveChannelDoc(
          user.uid,
          {
            id,
            name,
            provider: entry.provider ?? 'custom',
            category: entry.category?.trim() || 'Importiert',
            language: entry.language?.trim() || 'Deutsch (DE)',
            quality: entry.quality ?? 'Full HD',
            protocol: entry.protocol,
            ip,
            port,
            path: normalizePath(entry.path ?? '', entry.protocol),
            tvgId: entry.tvgId?.trim() || slugifyChannelName(name),
            enabled: true,
            upstreamUrl:
              entry.upstreamUrl?.trim() && isValidUpstreamUrl(entry.upstreamUrl)
                ? entry.upstreamUrl.trim()
                : undefined,
          },
          true
        );
        createdIds.push(id);
      }

      if (payload.targetPlaylistId && createdIds.length > 0) {
        const pl = store.playlists.find(
          (p) => p.id === payload.targetPlaylistId
        );
        if (pl) {
          await savePlaylistDoc(
            user.uid,
            {
              ...pl,
              channelIds: Array.from(
                new Set([...pl.channelIds, ...createdIds])
              ).slice(0, 200),
            },
            false
          );
        }
      } else if (payload.newPlaylistName?.trim() && createdIds.length > 0) {
        const plId = makeClientId('pl', payload.newPlaylistName);
        await savePlaylistDoc(
          user.uid,
          {
            id: plId,
            name: payload.newPlaylistName.trim(),
            description: `Importierte Playlist (${createdIds.length} Kanäle)`,
            channelIds: createdIds.slice(0, 200),
            protocolOverride: 'channel',
          },
          true
        );
        setSelectedPlaylistId(plId);
      }

      notify(`${createdIds.length} Kanäle in Cloud-Sync importiert.`);
      return;
    }

    const res = await api.importChannels(payload);
    setStore(res.store);
    if (res.store.playlists[0]) {
      setSelectedPlaylistId(res.store.playlists[0].id);
    }
    notify(`${res.importedCount} Kanäle importiert.`);
  };

  const handleRestoreJson = async (nextStore: CentralStore) => {
    if (user) {
      await replaceUserWorkspaceDocs(user.uid, nextStore);
      setSelectedPlaylistId(nextStore.playlists[0]?.id ?? null);
      notify('Sicherung erfolgreich in Cloud-Sync wiederhergestellt.');
      return;
    }

    const res = await api.restoreJson(nextStore);
    setStore(res.store);
    setSelectedPlaylistId(res.store.playlists[0]?.id ?? null);
    notify('Sicherung erfolgreich wiederhergestellt.');
  };

  const handleResetDemo = async () => {
    if (user) {
      const initial = createInitialStore();
      await replaceUserWorkspaceDocs(user.uid, initial);
      setSelectedPlaylistId(initial.playlists[0]?.id ?? null);
      notify('Deutscher Werkskatalog in Cloud-Sync wiederhergestellt.');
      return;
    }

    const res = await api.resetDemo();
    setStore(res.store);
    setSelectedPlaylistId(res.store.playlists[0]?.id ?? null);
    notify('Deutscher Werkskatalog wiederhergestellt.');
  };

  // Multi-Turn Gemini Chatbot Handlers
  const handleSendChatMessage = async (payload: {
    message: string;
    taskMode: ChatTaskMode;
    forceSearch: boolean;
  }) => {
    const historyForApi = chatMessages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    const res = await api.aiChat({
      message: payload.message,
      history: historyForApi,
      taskMode: payload.taskMode,
      forceSearch: payload.forceSearch,
      channels: store.channels,
      playlists: store.playlists,
    });

    const nowUser = new Date().toISOString();
    const userMsg: ChatMessageItem = {
      id: makeClientId('msg', 'user'),
      role: 'user',
      text: payload.message,
      model: 'user',
      taskMode: payload.taskMode,
      createdAt: nowUser,
    };

    const nowAi = new Date(Date.now() + 10).toISOString();
    const assistantMsg: ChatMessageItem = {
      id: makeClientId('msg', 'ai'),
      role: 'assistant',
      text: res.text,
      model: res.model,
      taskMode: res.resolvedMode,
      sources: res.sources.length > 0 ? res.sources : undefined,
      suggestedPlaylist: res.suggestedPlaylist,
      createdAt: nowAi,
    };

    if (user) {
      await saveChatMessageDoc(user.uid, userMsg);
      await saveChatMessageDoc(user.uid, assistantMsg);
    } else {
      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
    }
  };

  const handleClearChatHistory = async () => {
    if (user) {
      if (chatMessages.length > 0) {
        await clearChatMessagesDocs(
          user.uid,
          chatMessages.map((m) => m.id)
        );
      }
    } else {
      setChatMessages([]);
    }
    notify('Chatverlauf gelöscht.');
  };

  const handleCreatePlaylistFromSuggestion = async (
    suggestion: SuggestedPlaylist
  ) => {
    if (user) {
      const newId = makeClientId('pl', suggestion.name);
      await savePlaylistDoc(
        user.uid,
        {
          id: newId,
          name: suggestion.name,
          description: suggestion.description,
          channelIds: suggestion.channelIds,
          protocolOverride: 'channel',
        },
        true
      );
      setSelectedPlaylistId(newId);
      setActiveView('playlists');
      notify(
        `KI-Playlist "${suggestion.name}" mit ${suggestion.channelIds.length} Kanälen erstellt.`
      );
      return;
    }

    const res = await api.createPlaylist({
      name: suggestion.name,
      description: suggestion.description,
      channelIds: suggestion.channelIds,
      protocolOverride: 'channel',
    });
    setStore(res.store);
    setSelectedPlaylistId(res.playlist.id);
    setActiveView('playlists');
    notify(
      `KI-Playlist "${res.playlist.name}" mit ${res.playlist.channelIds.length} Kanälen erstellt.`
    );
  };

  const appendSyncLog = useCallback((entry: SourceSyncLogItem) => {
    setSyncLogs((prev) => [entry, ...prev].slice(0, 40));
  }, []);

  const runCloudSourceSync = useCallback(
    async (
      source: StreamSource,
      uid: string,
      snapshotChannels: Channel[],
      snapshotPlaylists: Playlist[]
    ): Promise<SourceSyncLogItem> => {
      const now = new Date().toISOString();
      try {
        const fetched = await api.fetchSourceM3U(
          source.url,
          source.defaultIp,
          source.startPort
        );
        const merged = mergeParsedEntriesIntoStore({
          entries: fetched.entries,
          source,
          channels: snapshotChannels,
          playlists: snapshotPlaylists,
          nowIso: now,
        });
        const isNewPlaylist = !snapshotPlaylists.some(
          (p) => p.id === merged.targetPlaylist.id
        );
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

        await batchApplySourceSyncDocs(uid, {
          addedChannels: merged.addedChannels,
          updatedChannels: merged.updatedChannels,
          targetPlaylist: merged.targetPlaylist,
          isNewPlaylist,
          source: updatedSource,
        });

        return {
          id: makeClientId('log', source.name),
          sourceId: source.id,
          sourceName: source.name,
          playlistName: merged.targetPlaylist.name,
          addedCount: merged.addedChannels.length,
          updatedCount: merged.updatedChannels.length,
          linkedCount: merged.newlyLinkedCount,
          totalCount: merged.totalParsed,
          status: 'ok',
          syncedAt: now,
        };
      } catch (err) {
        const errMsg =
          err instanceof Error
            ? err.message
            : 'Quellen-Abgleich fehlgeschlagen.';
        const erroredSource: StreamSource = {
          ...source,
          lastSyncedAt: now,
          lastStatus: 'error',
          lastError: errMsg,
          updatedAt: now,
        };
        await saveStreamSourceDoc(uid, erroredSource, false).catch(() => {});
        return {
          id: makeClientId('log', source.name),
          sourceId: source.id,
          sourceName: source.name,
          playlistName: source.targetPlaylistName,
          addedCount: 0,
          updatedCount: 0,
          linkedCount: 0,
          totalCount: 0,
          status: 'error',
          error: errMsg,
          syncedAt: now,
        };
      }
    },
    []
  );

  const handleSyncSource = useCallback(
    async (sourceId: string, silent = false) => {
      if (syncingIds.includes(sourceId)) return;
      setSyncingIds((prev) => [...prev, sourceId]);
      try {
        if (user) {
          const src = (storeRef.current.streamSources ?? []).find(
            (s) => s.id === sourceId
          );
          if (!src) return;
          const logEntry = await runCloudSourceSync(
            src,
            user.uid,
            storeRef.current.channels,
            storeRef.current.playlists
          );
          appendSyncLog(logEntry);
          if (!silent || logEntry.addedCount > 0 || logEntry.linkedCount > 0) {
            notify(
              logEntry.status === 'ok'
                ? `Quelle "${src.name}": +${logEntry.addedCount} neue Kanäle in "${logEntry.playlistName}".`
                : `Quelle "${src.name}" Fehler: ${logEntry.error}`
            );
          }
          return;
        }

        const res = await api.syncSource(sourceId);
        setStore(res.store);
        appendSyncLog(res.logEntry);
        if (!silent || res.logEntry.addedCount > 0 || res.logEntry.linkedCount > 0) {
          notify(
            res.logEntry.status === 'ok'
              ? `Quelle "${res.source.name}": +${res.logEntry.addedCount} neu · ${res.logEntry.linkedCount} in "${res.logEntry.playlistName}".`
              : `Quelle "${res.source.name}" Fehler: ${res.logEntry.error}`
          );
        }
      } finally {
        setSyncingIds((prev) => prev.filter((id) => id !== sourceId));
      }
    },
    [syncingIds, user, runCloudSourceSync, appendSyncLog, notify]
  );

  const handleSyncAllSources = useCallback(
    async (silent = false) => {
      if (syncingAll) return;
      setSyncingAll(true);
      try {
        if (user) {
          const enabledSources = (storeRef.current.streamSources ?? []).filter(
            (s) => s.enabled
          );
          let workingChannels = [...storeRef.current.channels];
          let workingPlaylists = [...storeRef.current.playlists];
          let totalAdded = 0;
          let totalLinked = 0;

          for (const src of enabledSources) {
            const fetched = await api.fetchSourceM3U(
              src.url,
              src.defaultIp,
              src.startPort
            );
            const now = new Date().toISOString();
            const merged = mergeParsedEntriesIntoStore({
              entries: fetched.entries,
              source: src,
              channels: workingChannels,
              playlists: workingPlaylists,
              nowIso: now,
            });
            const isNewPlaylist = !workingPlaylists.some(
              (p) => p.id === merged.targetPlaylist.id
            );
            const updatedSource: StreamSource = {
              ...src,
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
            await batchApplySourceSyncDocs(user.uid, {
              addedChannels: merged.addedChannels,
              updatedChannels: merged.updatedChannels,
              targetPlaylist: merged.targetPlaylist,
              isNewPlaylist,
              source: updatedSource,
            });
            workingChannels = merged.nextChannels;
            workingPlaylists = merged.nextPlaylists;
            totalAdded += merged.addedChannels.length;
            totalLinked += merged.newlyLinkedCount;
            appendSyncLog({
              id: makeClientId('log', src.name),
              sourceId: src.id,
              sourceName: src.name,
              playlistName: merged.targetPlaylist.name,
              addedCount: merged.addedChannels.length,
              updatedCount: merged.updatedChannels.length,
              linkedCount: merged.newlyLinkedCount,
              totalCount: merged.totalParsed,
              status: 'ok',
              syncedAt: now,
            });
          }

          if (!silent || totalAdded > 0 || totalLinked > 0) {
            notify(
              `${enabledSources.length} Quellen aktualisiert: +${totalAdded} neue Kanäle.`
            );
          }
          return;
        }

        const res = await api.syncAllSources();
        setStore(res.store);
        res.logs.forEach((l) => appendSyncLog(l));
        const totalAdded = res.logs.reduce((sum, l) => sum + l.addedCount, 0);
        const totalLinked = res.logs.reduce((sum, l) => sum + l.linkedCount, 0);
        if (!silent || totalAdded > 0 || totalLinked > 0) {
          notify(
            `Alle Quellen aktualisiert: +${totalAdded} neue Kanäle · ${totalLinked} in Listen eingetragen.`
          );
        }
      } finally {
        setSyncingAll(false);
      }
    },
    [syncingAll, user, appendSyncLog, notify]
  );

  const handleCreateSource = async (payload: {
    name: string;
    url: string;
    targetPlaylistId?: string;
    targetPlaylistName?: string;
    autoRefresh: boolean;
    intervalMinutes: number;
    defaultIp: string;
    startPort: number;
  }) => {
    if (user) {
      const now = new Date().toISOString();
      const targetPlaylistId =
        payload.targetPlaylistId ||
        makeClientId('pl', payload.targetPlaylistName || payload.name);
      const existingPl = storeRef.current.playlists.find(
        (p) => p.id === targetPlaylistId
      );
      const targetPlaylistName =
        existingPl?.name ||
        payload.targetPlaylistName ||
        `Auto-Liste: ${payload.name}`;

      const newSource: StreamSource = {
        id: makeClientId('src', payload.name),
        name: payload.name,
        url: payload.url,
        targetPlaylistId,
        targetPlaylistName,
        autoRefresh: payload.autoRefresh,
        intervalMinutes: payload.intervalMinutes,
        enabled: true,
        defaultIp: payload.defaultIp,
        startPort: payload.startPort,
        lastStatus: 'idle',
        updatedAt: now,
      };
      await saveStreamSourceDoc(user.uid, newSource, true);
      const logEntry = await runCloudSourceSync(
        newSource,
        user.uid,
        storeRef.current.channels,
        storeRef.current.playlists
      );
      appendSyncLog(logEntry);
      notify(
        logEntry.status === 'ok'
          ? `Quelle "${newSource.name}" verbunden (+${logEntry.addedCount} neue Kanäle in "${logEntry.playlistName}").`
          : `Quelle gespeichert (${logEntry.error}).`
      );
      return;
    }

    const res = await api.createSource({ ...payload, syncNow: true });
    setStore(res.store);
    if (res.logEntry) appendSyncLog(res.logEntry);
    notify(
      res.logEntry?.status === 'ok'
        ? `Quelle "${res.source.name}" verbunden: +${res.logEntry.addedCount} neue Kanäle in "${res.logEntry.playlistName}".`
        : `Quelle "${res.source.name}" hinzugefügt.`
    );
  };

  const handleToggleSourceAutoRefresh = async (source: StreamSource) => {
    if (user) {
      await saveStreamSourceDoc(
        user.uid,
        { ...source, autoRefresh: !source.autoRefresh },
        false
      );
      return;
    }
    const res = await api.updateSource(source.id, {
      autoRefresh: !source.autoRefresh,
    });
    setStore(res.store);
  };

  const handleToggleSourceEnabled = async (source: StreamSource) => {
    if (user) {
      await saveStreamSourceDoc(
        user.uid,
        { ...source, enabled: !source.enabled },
        false
      );
      return;
    }
    const res = await api.updateSource(source.id, {
      enabled: !source.enabled,
    });
    setStore(res.store);
  };

  const handleDeleteSource = async (source: StreamSource) => {
    if (user) {
      await deleteStreamSourceDoc(user.uid, source.id);
      notify(`Quelle "${source.name}" entfernt.`);
      return;
    }
    const res = await api.deleteSource(source.id);
    setStore(res.store);
    notify(`Quelle "${source.name}" entfernt.`);
  };

  // Client-side background auto-sync loop: checks due sources on startup & every 30s
  const autoSyncTickRef = useRef(false);
  useEffect(() => {
    if (loading) return;

    const tick = async () => {
      if (autoSyncTickRef.current) return;
      const sources = storeRef.current.streamSources ?? [];
      const due = sources.filter((s) => isSourceDueForSync(s));
      if (due.length === 0) {
        if (!user) {
          // Keep UI in sync with server's own background auto-sync
          try {
            const latest = await api.getStore();
            if (
              latest.channels.length !== storeRef.current.channels.length ||
              latest.playlists.length !== storeRef.current.playlists.length
            ) {
              setStore(latest);
            }
          } catch {
            // Ignore background poll error
          }
        }
        return;
      }

      autoSyncTickRef.current = true;
      try {
        for (const src of due) {
          await handleSyncSource(src.id, true);
        }
      } finally {
        autoSyncTickRef.current = false;
      }
    };

    const initialTimer = window.setTimeout(() => {
      tick().catch(() => {});
    }, 1800);
    const interval = window.setInterval(() => {
      tick().catch(() => {});
    }, 30_000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [loading, user, handleSyncSource]);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        playlists={store.playlists}
        selectedPlaylistId={selectedPlaylistId}
        onSelectPlaylist={(id) => {
          setSelectedPlaylistId(id);
          setActiveView('playlists');
        }}
        channelCount={store.channels.length}
        sourceCount={(store.streamSources ?? []).length}
        conflictCount={conflicts.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        user={
          user
            ? {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
              }
            : null
        }
        authLoading={authLoading}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onOpenTestPlayer={() =>
          setPlayerModal({
            open: true,
            scope: 'all',
            playlistChannels: [],
            initialChannelId: store.channels[0]?.id ?? null,
            contextTitle: 'Alle Kanäle',
          })
        }
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeView={activeView}
          selectedPlaylistName={selectedPlaylistName}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNewChannel={() => {
            setEditingChannel(null);
            setChannelModalOpen(true);
          }}
          onNewPlaylist={() => {
            setEditingPlaylist(null);
            setPlaylistModalOpen(true);
          }}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {loadError ? (
            <div
              role="alert"
              className="bg-white border border-red-200 rounded-lg p-6 text-center space-y-3"
            >
              <div className="text-sm font-semibold text-red-700">
                {loadError}
              </div>
              <button
                type="button"
                onClick={fetchStore}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                Erneut verbinden
              </button>
            </div>
          ) : (
            <>
              {activeView === 'channels' && (
                <ChannelDirectory
                  channels={store.channels}
                  playlists={store.playlists}
                  conflicts={conflicts}
                  loading={loading}
                  reachabilityById={reachabilityById}
                  checkingReachability={checkingReachability}
                  lastReachabilityAt={lastReachabilityAt}
                  reachabilityIntervalMs={reachabilityIntervalMs}
                  onChangeReachabilityInterval={setReachabilityIntervalMs}
                  onCheckReachabilityNow={checkReachabilityNow}
                  onEditChannel={(ch) => {
                    setEditingChannel(ch);
                    setChannelModalOpen(true);
                  }}
                  onDeleteChannel={handleDeleteChannel}
                  onToggleEnabled={handleToggleEnabled}
                  onOpenBulkLinkModal={(ids) => setLinkModalChannelIds(ids)}
                  onGoToIpGeneratorWithSelection={(ids) => {
                    setIpGenPreselection(ids);
                    setActiveView('ip-generator');
                  }}
                  onNewChannel={() => {
                    setEditingChannel(null);
                    setChannelModalOpen(true);
                  }}
                  onOpenTestPlayer={(ch) =>
                    setPlayerModal({
                      open: true,
                      scope: 'all',
                      playlistChannels: [],
                      initialChannelId: ch.id,
                      contextTitle: 'Kanal-Check',
                    })
                  }
                />
              )}

              {activeView === 'playlists' && (
                <PlaylistWorkspace
                  playlists={store.playlists}
                  channels={store.channels}
                  selectedPlaylistId={selectedPlaylistId}
                  onSelectPlaylist={setSelectedPlaylistId}
                  onNewPlaylist={() => {
                    setEditingPlaylist(null);
                    setPlaylistModalOpen(true);
                  }}
                  onEditPlaylist={(pl) => {
                    setEditingPlaylist(pl);
                    setPlaylistModalOpen(true);
                  }}
                  onDeletePlaylist={handleDeletePlaylist}
                  onReorderChannels={handleReorderChannels}
                  onAddChannelsToPlaylist={handleAddChannelsToPlaylist}
                  onRemoveChannelFromPlaylist={handleRemoveChannelFromPlaylist}
                  onOpenTestPlayer={(ch, playlistChannels, playlistName) =>
                    setPlayerModal({
                      open: true,
                      scope: 'playlist',
                      playlistChannels,
                      initialChannelId: ch.id,
                      contextTitle: playlistName,
                    })
                  }
                />
              )}

              {activeView === 'sources' && (
                <SourcesSyncView
                  sources={store.streamSources ?? []}
                  playlists={store.playlists}
                  channels={store.channels}
                  syncLogs={syncLogs}
                  syncingIds={syncingIds}
                  syncingAll={syncingAll}
                  onCreateSource={handleCreateSource}
                  onToggleSourceAutoRefresh={handleToggleSourceAutoRefresh}
                  onToggleSourceEnabled={handleToggleSourceEnabled}
                  onSyncSource={(id) => handleSyncSource(id, false)}
                  onSyncAllSources={() => handleSyncAllSources(false)}
                  onDeleteSource={handleDeleteSource}
                  onOpenPlaylist={(playlistId) => {
                    setSelectedPlaylistId(playlistId);
                    setActiveView('playlists');
                  }}
                />
              )}

              {activeView === 'ip-generator' && (
                <IpGeneratorView
                  channels={store.channels}
                  ipProfiles={store.ipProfiles}
                  conflicts={conflicts}
                  preselectedChannelIds={ipGenPreselection}
                  onClearPreselection={() => setIpGenPreselection([])}
                  onApplyBulkIp={handleApplyBulkIp}
                  onCreateProfile={handleCreateIpProfile}
                  onDeleteProfile={handleDeleteIpProfile}
                />
              )}

              {activeView === 'ai' && (
                <AiAssistantView
                  channels={store.channels}
                  playlists={store.playlists}
                  messages={chatMessages}
                  onSendMessage={handleSendChatMessage}
                  onClearHistory={handleClearChatHistory}
                  onCreatePlaylistFromSuggestion={
                    handleCreatePlaylistFromSuggestion
                  }
                />
              )}

              {activeView === 'import-export' && (
                <ImportExportView
                  store={store}
                  playlists={store.playlists}
                  onImportEntries={handleImportEntries}
                  onRestoreJson={handleRestoreJson}
                  onResetDemo={handleResetDemo}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      <ChannelModal
        open={channelModalOpen}
        editingChannel={editingChannel}
        playlists={store.playlists}
        onClose={() => setChannelModalOpen(false)}
        onSubmit={handleSaveChannel}
      />

      <PlaylistModal
        open={playlistModalOpen}
        editingPlaylist={editingPlaylist}
        onClose={() => setPlaylistModalOpen(false)}
        onSubmit={handleSavePlaylist}
      />

      <LinkPlaylistModal
        open={linkModalChannelIds !== null}
        channelIds={linkModalChannelIds ?? []}
        playlists={store.playlists}
        onClose={() => setLinkModalChannelIds(null)}
        onLinkToExisting={handleLinkToExisting}
        onCreateAndLink={handleCreateAndLink}
      />

      <TestPlayerModal
        open={playerModal.open}
        channels={
          playerModal.scope === 'playlist'
            ? playerModal.playlistChannels
            : store.channels
        }
        initialChannelId={playerModal.initialChannelId}
        contextTitle={playerModal.contextTitle}
        onEditChannel={(ch) => {
          setPlayerModal((prev) => ({ ...prev, open: false }));
          setEditingChannel(ch);
          setChannelModalOpen(true);
        }}
        onClose={() =>
          setPlayerModal((prev) => ({ ...prev, open: false }))
        }
      />

      {/* Toast feedback */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-slate-900 text-white text-sm px-4 py-3 rounded-lg shadow-lg border border-slate-800"
        >
          <CheckCircle2
            className="w-4 h-4 text-emerald-400 shrink-0"
            aria-hidden="true"
          />
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Hinweis schließen"
            className="ml-1 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
