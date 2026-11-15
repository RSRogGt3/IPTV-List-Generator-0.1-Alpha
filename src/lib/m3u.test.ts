import test from 'node:test';
import assert from 'node:assert/strict';
import { generateM3U, parseM3U } from './m3u';
import { createInitialStore, upgradeStoreWithOnlineCatalog } from './seedData';

test('generateM3U produces valid #EXTM3U output for linked channels', () => {
  const store = createInitialStore();
  const playlist = store.playlists[0];
  const outputAuto = generateM3U(playlist, store.channels, { mode: 'auto' });
  const outputLocal = generateM3U(playlist, store.channels, { mode: 'local' });

  assert.equal(outputAuto.startsWith('#EXTM3U'), true);
  assert.equal(outputAuto.includes('Das Erste HD (ARD)'), true);
  assert.equal(
    outputAuto.includes('https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8'),
    true
  );
  assert.equal(outputLocal.includes('http://192.168.178.90:8401/live/das-erste'), true);

  const onlineChannels = store.channels.filter((c) => Boolean(c.upstreamUrl));
  const atChChannels = store.channels.filter((c) => c.provider === 'at_ch');
  assert.ok(onlineChannels.length >= 88);
  assert.ok(store.channels.length >= 115);
  assert.ok(atChChannels.length >= 18);
  assert.ok((store.streamSources ?? []).length >= 3);

  const disneyChannel = store.channels.find((c) => c.id === 'disney-channel-de');
  assert.equal(disneyChannel?.provider, 'disney');
  assert.ok(disneyChannel?.upstreamUrl?.startsWith('https://'));

  const hubsPlaylist = store.playlists.find((p) => p.id === 'pl-streaming-hubs');
  assert.ok(hubsPlaylist);
  const playableOnlyOut = generateM3U(hubsPlaylist, store.channels, {
    mode: 'auto',
    playableOnly: true,
  });
  assert.equal(playableOnlyOut.includes('Disney Channel DE HD'), true);
  assert.equal(playableOnlyOut.includes('Sky Sport Bundesliga 1 HD'), false);
});

test('upgradeStoreWithOnlineCatalog backfills upstreamUrls, migrates legacy ORF channels to at_ch, and preserves custom channels', () => {
  const legacyStore = createInitialStore();
  const legacyOrf = legacyStore.channels.find((c) => c.id === 'orf1-hd');
  assert.ok(legacyOrf);
  const stripped = {
    ...legacyStore,
    channels: [
      { ...legacyStore.channels[0], upstreamUrl: undefined },
      { ...legacyOrf, provider: 'public_de' as const, upstreamUrl: undefined },
      {
        id: 'user-custom-1',
        name: 'Mein Lokaler Testkanal',
        provider: 'custom' as const,
        category: 'Test',
        language: 'DE',
        quality: 'Full HD' as const,
        protocol: 'http' as const,
        ip: '192.168.178.250',
        port: 9123,
        path: '/live/custom',
        tvgId: 'user-custom-1',
        enabled: true,
        updatedAt: '2026-11-14T08:00:00.000Z',
      },
    ],
    playlists: [legacyStore.playlists[0]],
    streamSources: [],
  };

  const upgraded = upgradeStoreWithOnlineCatalog(stripped);
  assert.equal(upgraded.changed, true);
  assert.ok(upgraded.backfilledUpstreamCount >= 2);
  assert.ok(upgraded.addedChannelsCount >= 110);
  assert.ok(upgraded.addedPlaylistsCount >= 5);
  assert.ok(upgraded.addedSourcesCount >= 3);

  const ard = upgraded.store.channels.find((c) => c.id === 'das-erste');
  assert.equal(
    ard?.upstreamUrl,
    'https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8'
  );
  const migratedOrf = upgraded.store.channels.find((c) => c.id === 'orf1-hd');
  assert.equal(migratedOrf?.provider, 'at_ch');
  assert.ok(migratedOrf?.upstreamUrl?.startsWith('https://'));

  assert.ok(upgraded.store.channels.some((c) => c.id === 'user-custom-1'));
  assert.ok(upgraded.store.playlists.some((p) => p.id === 'pl-dach-at-ch'));
  assert.ok(upgraded.store.playlists.some((p) => p.id === 'pl-sport-musik-doku'));
  assert.ok(upgraded.store.playlists.some((p) => p.id === 'pl-iptv-org-dach'));
  assert.ok(
    (upgraded.store.streamSources ?? []).some((s) => s.id === 'src-iptv-org-dach')
  );
});

test('parseM3U extracts German channels, providers, and endpoints', () => {
  const raw = `#EXTM3U
#EXTINF:-1 tvg-id="sky-1" group-title="Sky Sport",Sky Sport Bundesliga 1 HD
http://192.168.178.55:8080/live/sky-b1
#EXTINF:-1 tvg-id="zdf" group-title="Öffentlich",ZDF HD
http://192.168.178.55:8081/live/zdf
#EXTINF:-1 group-title="Streaming",Disney+ DE 4K
https://192.168.178.80:8301/stream/disney
`;

  const parsed = parseM3U(raw);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].provider, 'sky');
  assert.equal(parsed[0].ip, '192.168.178.55');
  assert.equal(parsed[0].port, 8080);
  assert.equal(parsed[1].provider, 'public_de');
  assert.equal(parsed[2].provider, 'disney');
  assert.equal(parsed[2].quality, '4K UHD');
});

test('generateM3U supports upstreamUrl in auto/upstream/proxy modes and local IP fallback', () => {
  const store = createInitialStore();
  const baseChannel = store.channels[0];
  const channels = [
    {
      ...baseChannel,
      upstreamUrl: 'https://streams.example.de/live/ard.m3u8',
    },
  ];
  const playlist = {
    ...store.playlists[0],
    channelIds: [baseChannel.id],
  };

  const autoOut = generateM3U(playlist, channels, { mode: 'auto' });
  assert.equal(autoOut.includes('https://streams.example.de/live/ard.m3u8'), true);

  const localOut = generateM3U(playlist, channels, { mode: 'local' });
  assert.equal(localOut.includes(`http://${baseChannel.ip}:${baseChannel.port}${baseChannel.path}`), true);

  const proxyOut = generateM3U(playlist, channels, {
    mode: 'proxy',
    origin: 'https://example.run.app',
  });
  assert.equal(
    proxyOut.includes(`https://example.run.app/api/channels/${baseChannel.id}/stream`),
    true
  );
});

test('parseM3U preserves external domain URLs as upstreamUrl and infers at_ch for Austrian/Swiss stations', () => {
  const raw = `#EXTM3U
#EXTINF:-1 group-title="Öffentlich-Rechtlich",Das Erste Live
https://mcdn.daserste.de/daserste/de/master.m3u8
#EXTINF:-1 group-title="Austria",ORF 1 HD
https://orf1.mdn.ors.at/out/u/orf1/qxb/manifest.m3u8
#EXTINF:-1 group-title="Switzerland",Carac 1 CH
https://carac-1.live/playlist.m3u8
`;
  const parsed = parseM3U(raw);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].upstreamUrl, 'https://mcdn.daserste.de/daserste/de/master.m3u8');
  assert.equal(parsed[0].provider, 'public_de');
  assert.equal(parsed[1].provider, 'at_ch');
  assert.equal(parsed[2].provider, 'at_ch');
});
