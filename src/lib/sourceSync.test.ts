import assert from 'node:assert/strict';
import test from 'node:test';
import { parseM3U } from './m3u';
import {
  isSourceDueForSync,
  isValidSourceUrl,
  mergeParsedEntriesIntoStore,
} from './sourceSync';
import { Channel, Playlist, StreamSource } from './types';

const SAMPLE_SOURCE: StreamSource = {
  id: 'src-de-auto',
  name: 'DE Auto Feed',
  url: '/api/feeds/de-live-quellen.m3u',
  targetPlaylistId: 'pl-auto-test',
  targetPlaylistName: 'Auto Test Liste',
  autoRefresh: true,
  intervalMinutes: 5,
  enabled: true,
  defaultIp: '192.168.178.150',
  startPort: 8700,
  updatedAt: '2026-11-14T08:00:00.000Z',
};

test('isValidSourceUrl allows safe built-in feeds and http(s) URLs, rejects traversal & others', () => {
  assert.equal(isValidSourceUrl('/api/feeds/de-live-quellen.m3u'), true);
  assert.equal(isValidSourceUrl('/api/feeds/iptv-org-dach.m3u'), true);
  assert.equal(isValidSourceUrl('https://example.org/channels.m3u8'), true);
  assert.equal(isValidSourceUrl('/api/feeds/../secret.m3u'), false);
  assert.equal(isValidSourceUrl('/api/feeds/..'), false);
  assert.equal(isValidSourceUrl('https://example.org/channels.m3u8\n#EXTINF:-1,Fake'), false);
  assert.equal(isValidSourceUrl('ftp://example.org/list.m3u'), false);
  assert.equal(isValidSourceUrl('/api/playlists/abc/export.m3u'), false);
});

test('isSourceDueForSync respects enabled, autoRefresh, and intervalMinutes', () => {
  const now = Date.parse('2026-11-14T10:00:00.000Z');
  assert.equal(isSourceDueForSync(SAMPLE_SOURCE, now), true);

  const recent: StreamSource = {
    ...SAMPLE_SOURCE,
    lastSyncedAt: '2026-11-14T09:57:00.000Z',
  };
  assert.equal(isSourceDueForSync(recent, now), false);

  const expired: StreamSource = {
    ...SAMPLE_SOURCE,
    lastSyncedAt: '2026-11-14T09:54:00.000Z',
  };
  assert.equal(isSourceDueForSync(expired, now), true);
  assert.equal(
    isSourceDueForSync({ ...expired, autoRefresh: false }, now),
    false
  );
});

test('mergeParsedEntriesIntoStore adds new channels without IP conflicts and inserts them into target playlist', () => {
  const existingChannel: Channel = {
    id: 'ch-das-erste-hd',
    name: 'Das Erste HD (ARD)',
    provider: 'public_de',
    category: 'Vollprogramm',
    language: 'Deutsch (DE)',
    quality: 'Full HD',
    protocol: 'http',
    ip: '192.168.178.150',
    port: 8700,
    path: '/live/das-erste',
    tvgId: 'das-erste',
    enabled: true,
    updatedAt: '2026-11-14T08:00:00.000Z',
  };

  const existingPlaylist: Playlist = {
    id: 'pl-auto-test',
    name: 'Auto Test Liste',
    description: 'Vorhandene Liste',
    channelIds: ['ch-das-erste-hd'],
    protocolOverride: 'channel',
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
  };

  const rawM3U = `#EXTM3U
#EXTINF:-1 tvg-id="das-erste" group-title="Öffentlich-Rechtlich",Das Erste HD (ARD)
https://example.org/streams/das-erste.m3u8
#EXTINF:-1 tvg-id="sky-sport-news" group-title="Sky Deutschland",Sky Sport News HD
http://192.168.178.150:8700/live/sky-sport-news
#EXTINF:-1 tvg-id="zdf-info-neu" group-title="Öffentlich-Rechtlich",ZDFinfo Live HD
https://example.org/streams/zdfinfo.m3u8`;

  const entries = parseM3U(rawM3U, {
    defaultIp: SAMPLE_SOURCE.defaultIp,
    startPort: SAMPLE_SOURCE.startPort,
  });

  const merged = mergeParsedEntriesIntoStore({
    entries,
    source: SAMPLE_SOURCE,
    channels: [existingChannel],
    playlists: [existingPlaylist],
    nowIso: '2026-11-14T10:05:00.000Z',
  });

  // 1 existing updated (upstreamUrl added), 2 newly added
  assert.equal(merged.addedChannels.length, 2);
  assert.equal(merged.updatedChannels.length, 1);
  assert.equal(merged.nextChannels.length, 3);

  // Target playlist automatically received the 2 new channel IDs without duplicates
  assert.equal(merged.newlyLinkedCount, 2);
  assert.equal(merged.targetPlaylist.channelIds.length, 3);
  assert.ok(merged.targetPlaylist.channelIds.includes('ch-das-erste-hd'));

  // Verify conflict-free IP/port allocation on the newly added channel
  const skyNews = merged.addedChannels.find((c) =>
    c.name.includes('Sky Sport News')
  );
  assert.ok(skyNews);
  assert.notEqual(
    `${skyNews.ip}:${skyNews.port}${skyNews.path}`,
    `${existingChannel.ip}:${existingChannel.port}${existingChannel.path}`
  );

  // Re-running with the same feed must be idempotent (0 new, 0 newly linked)
  const secondRun = mergeParsedEntriesIntoStore({
    entries,
    source: SAMPLE_SOURCE,
    channels: merged.nextChannels,
    playlists: merged.nextPlaylists,
    nowIso: '2026-11-14T10:10:00.000Z',
  });
  assert.equal(secondRun.addedChannels.length, 0);
  assert.equal(secondRun.newlyLinkedCount, 0);
  assert.equal(secondRun.targetPlaylist.channelIds.length, 3);
});

test('mergeParsedEntriesIntoStore caps target playlist channelIds at 200', () => {
  const existingIds = Array.from({ length: 199 }, (_, idx) => `ch-existing-${idx}`);
  const fullPlaylist: Playlist = {
    id: 'pl-cap-test',
    name: 'Cap Test',
    description: '',
    channelIds: existingIds,
    protocolOverride: 'channel',
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
  };
  const source: StreamSource = {
    ...SAMPLE_SOURCE,
    targetPlaylistId: 'pl-cap-test',
    targetPlaylistName: 'Cap Test',
  };
  const entries = parseM3U(
    `#EXTM3U
#EXTINF:-1,Kanal Alpha
https://example.org/alpha.m3u8
#EXTINF:-1,Kanal Beta
https://example.org/beta.m3u8`,
    { defaultIp: '192.168.178.150', startPort: 8800 }
  );

  const merged = mergeParsedEntriesIntoStore({
    entries,
    source,
    channels: [],
    playlists: [fullPlaylist],
    nowIso: '2026-11-15T10:00:00.000Z',
  });

  assert.equal(merged.targetPlaylist.channelIds.length, 200);
  assert.equal(merged.newlyLinkedCount, 1);
});
