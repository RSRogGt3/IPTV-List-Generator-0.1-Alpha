export type ProviderId =
  | 'sky'
  | 'netflix'
  | 'amazon'
  | 'disney'
  | 'public_de'
  | 'private_de'
  | 'at_ch'
  | 'custom';

export type StreamProtocol = 'http' | 'https' | 'rtsp' | 'udp' | 'rtp';

export type ChannelQuality = '4K UHD' | 'Full HD' | 'HD' | 'SD';

export type M3UExportMode = 'auto' | 'local' | 'upstream' | 'proxy';

export type ChannelReachabilityStatus =
  | 'reachable'
  | 'private-lan'
  | 'unreachable'
  | 'timeout'
  | 'invalid';

export interface ChannelReachabilityResult {
  channelId: string;
  targetUrl: string;
  source: 'upstream' | 'local-ip';
  status: ChannelReachabilityStatus;
  httpStatus?: number;
  latencyMs?: number;
  detail: string;
  checkedAt: string;
}

export interface Channel {
  id: string;
  name: string;
  provider: ProviderId;
  category: string;
  language: string;
  quality: ChannelQuality;
  protocol: StreamProtocol;
  ip: string;
  port: number;
  path: string;
  tvgId: string;
  enabled: boolean;
  upstreamUrl?: string;
  notes?: string;
  updatedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  channelIds: string[];
  protocolOverride?: StreamProtocol | 'channel';
  createdAt: string;
  updatedAt: string;
}

export type IpGenerationMode = 'increment-port' | 'increment-ip' | 'provider-blocks';

export interface IpProfile {
  id: string;
  name: string;
  description: string;
  baseIp: string;
  startPort: number;
  protocol: StreamProtocol;
  mode: IpGenerationMode;
  pathPrefix: string;
}

export interface IpGenerationConfig {
  baseIp: string;
  startPort: number;
  protocol: StreamProtocol;
  mode: IpGenerationMode;
  pathPrefix: string;
  includeChannelSlugInPath: boolean;
}

export interface ConflictItem {
  endpointKey: string;
  protocol: StreamProtocol;
  ip: string;
  port: number;
  path: string;
  channels: { id: string; name: string; provider: ProviderId }[];
}

export type SourceSyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

export interface StreamSource {
  id: string;
  name: string;
  url: string;
  targetPlaylistId: string;
  targetPlaylistName: string;
  autoRefresh: boolean;
  intervalMinutes: number;
  enabled: boolean;
  defaultIp: string;
  startPort: number;
  lastSyncedAt?: string;
  lastStatus?: SourceSyncStatus;
  lastAddedCount?: number;
  lastUpdatedCount?: number;
  lastTotalCount?: number;
  lastError?: string;
  updatedAt: string;
}

export interface SourceSyncLogItem {
  id: string;
  sourceId: string;
  sourceName: string;
  playlistName: string;
  addedCount: number;
  updatedCount: number;
  linkedCount: number;
  totalCount: number;
  status: 'ok' | 'error';
  error?: string;
  syncedAt: string;
}

export interface CentralStore {
  channels: Channel[];
  playlists: Playlist[];
  ipProfiles: IpProfile[];
  streamSources?: StreamSource[];
}

export const PROVIDER_META: Record<
  ProviderId,
  { label: string; shortLabel: string; defaultBlockOffset: number }
> = {
  sky: { label: 'Sky Deutschland', shortLabel: 'Sky', defaultBlockOffset: 10 },
  netflix: { label: 'Netflix DE', shortLabel: 'Netflix', defaultBlockOffset: 30 },
  amazon: { label: 'Amazon Prime Video', shortLabel: 'Amazon Prime', defaultBlockOffset: 50 },
  disney: { label: 'Disney+', shortLabel: 'Disney+', defaultBlockOffset: 70 },
  public_de: { label: 'Öffentlich-Rechtlich (ARD/ZDF)', shortLabel: 'Öffentlich-Rechtlich', defaultBlockOffset: 90 },
  private_de: { label: 'Private Sender DE', shortLabel: 'Private DE', defaultBlockOffset: 130 },
  at_ch: { label: 'Österreich & Schweiz (DACH)', shortLabel: 'AT & CH', defaultBlockOffset: 155 },
  custom: { label: 'Eigene Kanäle', shortLabel: 'Eigene', defaultBlockOffset: 180 },
};
