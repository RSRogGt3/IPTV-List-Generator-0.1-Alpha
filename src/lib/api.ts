import {
  ChatTaskMode,
  GroundingSource,
  SuggestedPlaylist,
} from './aiRouting';
import { ParsedM3UEntry } from './m3u';
import {
  CentralStore,
  Channel,
  ChannelReachabilityResult,
  IpGenerationConfig,
  IpProfile,
  Playlist,
  SourceSyncLogItem,
  StreamSource,
} from './types';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Serverfehler (${res.status})`);
  }
  return data as T;
}

export const api = {
  getPublicConfig: () =>
    requestJson<{ appUrl: string }>('/api/config/public-url'),

  getStore: () => requestJson<CentralStore>('/api/store'),

  syncWorkspace: (payload: {
    uid: string;
    channels: Channel[];
    playlists: Playlist[];
  }) =>
    requestJson<{ ok: boolean; syncedPlaylists: number }>(
      '/api/sync/workspace',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  checkEndpoints: (channels: Channel[]) =>
    requestJson<{ results: ChannelReachabilityResult[] }>(
      '/api/channels/check-endpoints',
      {
        method: 'POST',
        body: JSON.stringify({ channels }),
      }
    ),

  createChannel: (
    payload: Omit<Channel, 'id' | 'updatedAt'> & { playlistIds?: string[] }
  ) =>
    requestJson<{ channel: Channel; store: CentralStore }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateChannel: (
    id: string,
    payload: Partial<Omit<Channel, 'id' | 'updatedAt'>> & {
      playlistIds?: string[];
    }
  ) =>
    requestJson<{ channel: Channel; store: CentralStore }>(
      `/api/channels/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteChannel: (id: string) =>
    requestJson<{ store: CentralStore }>(
      `/api/channels/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  bulkGenerateIp: (channelIds: string[], config: IpGenerationConfig) =>
    requestJson<{ updatedCount: number; store: CentralStore }>(
      '/api/channels/bulk-ip',
      {
        method: 'POST',
        body: JSON.stringify({ channelIds, config }),
      }
    ),

  importChannels: (payload: {
    entries: ParsedM3UEntry[];
    targetPlaylistId?: string;
    newPlaylistName?: string;
  }) =>
    requestJson<{ importedCount: number; store: CentralStore }>(
      '/api/channels/import',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createPlaylist: (payload: {
    name: string;
    description: string;
    channelIds?: string[];
    protocolOverride?: Playlist['protocolOverride'];
  }) =>
    requestJson<{ playlist: Playlist; store: CentralStore }>('/api/playlists', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePlaylist: (
    id: string,
    payload: Partial<
      Pick<Playlist, 'name' | 'description' | 'channelIds' | 'protocolOverride'>
    >
  ) =>
    requestJson<{ playlist: Playlist; store: CentralStore }>(
      `/api/playlists/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  linkChannelsToPlaylist: (playlistId: string, channelIds: string[]) =>
    requestJson<{ added: number; playlist: Playlist; store: CentralStore }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/channels`,
      {
        method: 'POST',
        body: JSON.stringify({ channelIds }),
      }
    ),

  unlinkChannelFromPlaylist: (playlistId: string, channelId: string) =>
    requestJson<{ playlist: Playlist; store: CentralStore }>(
      `/api/playlists/${encodeURIComponent(playlistId)}/channels/${encodeURIComponent(channelId)}`,
      { method: 'DELETE' }
    ),

  deletePlaylist: (id: string) =>
    requestJson<{ store: CentralStore }>(
      `/api/playlists/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  createIpProfile: (payload: Omit<IpProfile, 'id'>) =>
    requestJson<{ profile: IpProfile; store: CentralStore }>(
      '/api/ip-profiles',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  deleteIpProfile: (id: string) =>
    requestJson<{ store: CentralStore }>(
      `/api/ip-profiles/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  restoreJson: (store: CentralStore) =>
    requestJson<{ store: CentralStore }>('/api/store/restore-json', {
      method: 'POST',
      body: JSON.stringify(store),
    }),

  resetDemo: () =>
    requestJson<{ store: CentralStore }>('/api/store/reset', {
      method: 'POST',
    }),

  getSources: () =>
    requestJson<{ streamSources: StreamSource[] }>('/api/sources'),

  createSource: (payload: {
    name: string;
    url: string;
    targetPlaylistId?: string;
    targetPlaylistName?: string;
    autoRefresh?: boolean;
    intervalMinutes?: number;
    defaultIp?: string;
    startPort?: number;
    syncNow?: boolean;
  }) =>
    requestJson<{
      source: StreamSource;
      logEntry?: SourceSyncLogItem;
      store: CentralStore;
    }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSource: (
    id: string,
    payload: Partial<
      Pick<
        StreamSource,
        | 'name'
        | 'url'
        | 'targetPlaylistId'
        | 'targetPlaylistName'
        | 'autoRefresh'
        | 'intervalMinutes'
        | 'enabled'
        | 'defaultIp'
        | 'startPort'
      >
    >
  ) =>
    requestJson<{ source: StreamSource; store: CentralStore }>(
      `/api/sources/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  deleteSource: (id: string) =>
    requestJson<{ store: CentralStore }>(
      `/api/sources/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  syncSource: (id: string) =>
    requestJson<{
      source: StreamSource;
      logEntry: SourceSyncLogItem;
      store: CentralStore;
    }>(`/api/sources/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
    }),

  syncAllSources: () =>
    requestJson<{ logs: SourceSyncLogItem[]; store: CentralStore }>(
      '/api/sources/sync-all',
      { method: 'POST' }
    ),

  fetchSourceM3U: (url: string, defaultIp?: string, startPort?: number) =>
    requestJson<{ entries: ParsedM3UEntry[]; totalCount: number }>(
      '/api/sources/fetch-m3u',
      {
        method: 'POST',
        body: JSON.stringify({ url, defaultIp, startPort }),
      }
    ),

  aiChat: (payload: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
    taskMode: ChatTaskMode;
    forceSearch?: boolean;
    channels: Channel[];
    playlists: Playlist[];
  }) =>
    requestJson<{
      text: string;
      model: string;
      resolvedMode: Exclude<ChatTaskMode, 'auto'>;
      useSearch: boolean;
      sources: GroundingSource[];
      suggestedPlaylist?: SuggestedPlaylist;
    }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiSearch: (payload: { query: string; providerFocus?: string }) =>
    requestJson<{
      answer: string;
      model: string;
      sources: GroundingSource[];
    }>('/api/ai/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiRecommendPlaylist: (payload: { goal: string; channels: Channel[] }) =>
    requestJson<SuggestedPlaylist & { model: string; rationale: string }>(
      '/api/ai/recommend-playlist',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};
