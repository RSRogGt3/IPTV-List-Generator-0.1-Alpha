import { CentralStore, Channel, IpProfile, Playlist, StreamSource } from './types';

const BASE_TIME = '2026-11-15T12:00:00.000Z';

function makeChannel(
  id: string,
  name: string,
  provider: Channel['provider'],
  category: string,
  ip: string,
  port: number,
  path: string,
  quality: Channel['quality'] = 'Full HD',
  protocol: Channel['protocol'] = 'http',
  upstreamUrl?: string,
  notes?: string,
  language = 'Deutsch (DE)'
): Channel {
  return {
    id,
    name,
    provider,
    category,
    language,
    quality,
    protocol,
    ip,
    port,
    path,
    tvgId: id,
    enabled: true,
    ...(upstreamUrl ? { upstreamUrl } : {}),
    ...(notes ? { notes } : {}),
    updatedAt: BASE_TIME,
  };
}

export function createInitialStore(): CentralStore {
  const channels: Channel[] = [
    // Öffentlich-Rechtliche Deutsche Sender (alle mit verifiziertem Live-HLS-Upstream)
    makeChannel(
      'das-erste',
      'Das Erste HD (ARD)',
      'public_de',
      'Vollprogramm',
      '192.168.178.90',
      8401,
      '/live/das-erste',
      'Full HD',
      'http',
      'https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8'
    ),
    makeChannel(
      'zdf-hd',
      'ZDF HD',
      'public_de',
      'Vollprogramm',
      '192.168.178.90',
      8402,
      '/live/zdf',
      'Full HD',
      'http',
      'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8'
    ),
    makeChannel(
      'zdf-neo',
      'ZDFneo HD',
      'public_de',
      'Unterhaltung',
      '192.168.178.90',
      8403,
      '/live/zdf-neo',
      'Full HD',
      'http',
      'https://zdf-hls-16.akamaized.net/hls/live/2016499/de/high/master.m3u8'
    ),
    makeChannel(
      'zdf-info',
      'ZDFinfo HD',
      'public_de',
      'Dokumentation',
      '192.168.178.90',
      8404,
      '/live/zdf-info',
      'Full HD',
      'http',
      'https://zdf-hls-17.akamaized.net/hls/live/2016500/de/high/master.m3u8'
    ),
    makeChannel(
      'arte-de',
      'ARTE Deutschland HD',
      'public_de',
      'Kultur & Doku',
      '192.168.178.90',
      8405,
      '/live/arte-de',
      'Full HD',
      'http',
      'https://artesimulcast.akamaized.net/hls/live/2030993/artelive_de/index.m3u8'
    ),
    makeChannel(
      'dreisat',
      '3sat HD',
      'public_de',
      'Kultur & Doku',
      '192.168.178.90',
      8406,
      '/live/3sat',
      'Full HD',
      'http',
      'https://zdf-hls-18.akamaized.net/hls/live/2016501/dach/high/master.m3u8'
    ),
    makeChannel(
      'phoenix',
      'Phoenix HD',
      'public_de',
      'Nachrichten & Politik',
      '192.168.178.90',
      8407,
      '/live/phoenix',
      'Full HD',
      'http',
      'https://zdf-hls-19.akamaized.net/hls/live/2016502/de/high/master.m3u8'
    ),
    makeChannel(
      'kika',
      'KiKA HD',
      'public_de',
      'Kinder',
      '192.168.178.90',
      8408,
      '/live/kika',
      'Full HD',
      'http',
      'https://kikageohls.akamaized.net/hls/live/2022693-b/livetvkika_de/master.m3u8'
    ),
    makeChannel(
      'tagesschau24',
      'tagesschau24 HD',
      'public_de',
      'Nachrichten',
      '192.168.178.90',
      8409,
      '/live/tagesschau24',
      'Full HD',
      'http',
      'https://tagesschau.akamaized.net/hls/live/2020115/tagesschau/tagesschau_1/master.m3u8'
    ),
    makeChannel(
      'wdr-hd',
      'WDR Fernsehen HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8410,
      '/live/wdr',
      'Full HD',
      'http',
      'https://wdr-live.ard-mcdn.de/wdr/live/hls/de/master.m3u8'
    ),
    makeChannel(
      'br-hd',
      'BR Fernsehen Süd HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8411,
      '/live/br',
      'Full HD',
      'http',
      'https://mcdn.br.de/br/fs/bfs_sued/hls/de/master.m3u8'
    ),
    makeChannel(
      'ndr-hd',
      'NDR Fernsehen NDS HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8412,
      '/live/ndr',
      'Full HD',
      'http',
      'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_nds/master.m3u8'
    ),
    makeChannel(
      'swr-hd',
      'SWR Fernsehen BW HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8413,
      '/live/swr',
      'Full HD',
      'http',
      'https://swrbwd-hls.akamaized.net/hls/live/2018672/swrbwd/master.m3u8'
    ),
    makeChannel(
      'mdr-hd',
      'MDR Fernsehen HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8414,
      '/live/mdr',
      'Full HD',
      'http',
      'https://mdrtvsnhls.akamaized.net/hls/live/2016928/mdrtvsn/master.m3u8'
    ),
    makeChannel(
      'ard-alpha-hd',
      'ARD-alpha HD',
      'public_de',
      'Bildung & Kultur',
      '192.168.178.90',
      8415,
      '/live/ard-alpha',
      'Full HD',
      'http',
      'https://mcdn.br.de/br/fs/ard_alpha/hls/de/master.m3u8'
    ),
    makeChannel(
      'one-hd-ard',
      'ONE HD (ARD)',
      'public_de',
      'Unterhaltung',
      '192.168.178.90',
      8416,
      '/live/one-hd',
      'Full HD',
      'http',
      'https://mcdn-one.ard.de/ardone/hls/master.m3u8'
    ),
    makeChannel(
      'hr-fernsehen-hd',
      'hr-fernsehen HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8417,
      '/live/hr-hd',
      'Full HD',
      'http',
      'https://hrhlsde.akamaized.net/hls/live/2024526/hrhlsde/index.m3u8'
    ),
    makeChannel(
      'rbb-berlin-hd',
      'rbb Fernsehen Berlin HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8418,
      '/live/rbb-berlin',
      'Full HD',
      'http',
      'https://rbb-hls-berlin.akamaized.net/hls/live/2017824/rbb_berlin/index.m3u8'
    ),
    makeChannel(
      'rbb-brandenburg-hd',
      'rbb Brandenburg HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8419,
      '/live/rbb-brandenburg',
      'Full HD',
      'http',
      'https://rbb-hls-brandenburg.akamaized.net/hls/live/2017825/rbb_brandenburg/index.m3u8'
    ),
    makeChannel(
      'sr-fernsehen-hd',
      'SR Fernsehen HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8420,
      '/live/sr-fernsehen',
      'Full HD',
      'http',
      'https://srfs.akamaized.net/hls/live/689649/srfsgeo/index.m3u8'
    ),
    makeChannel(
      'radio-bremen-tv',
      'Radio Bremen TV HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8421,
      '/live/radio-bremen',
      'Full HD',
      'http',
      'https://rbhlslive.akamaized.net/hls/live/2020435/rbfs/master.m3u8'
    ),
    makeChannel(
      'br-nord-hd',
      'BR Fernsehen Nord HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8422,
      '/live/br-nord',
      'Full HD',
      'http',
      'https://mcdn.br.de/br/fs/bfs_nord/hls/de/master.m3u8'
    ),
    makeChannel(
      'ndr-hh-hd',
      'NDR Fernsehen Hamburg HD',
      'public_de',
      'Regional (Dritte)',
      '192.168.178.90',
      8423,
      '/live/ndr-hh',
      'Full HD',
      'http',
      'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_hh/master.m3u8'
    ),
    makeChannel(
      'dw-deutsch-hd',
      'DW Deutsch HD (Deutsche Welle)',
      'public_de',
      'Nachrichten',
      '192.168.178.90',
      8424,
      '/live/dw-deutsch',
      'Full HD',
      'http',
      'https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8'
    ),
    makeChannel(
      'alex-berlin-hd',
      'Alex Berlin TV HD',
      'public_de',
      'Regional',
      '192.168.178.90',
      8428,
      '/live/alex-berlin',
      'Full HD',
      'http',
      'https://alex-stream.rosebud-media.de/bounce/alexlivetv50.smil/index.m3u8'
    ),
    makeChannel(
      'dasding-tv',
      'DASDING 90.8 Live (SWR)',
      'public_de',
      'Musik',
      '192.168.178.90',
      8429,
      '/live/dasding-tv',
      'Full HD',
      'http',
      'https://swrdasdingvr-hls.akamaized.net/hls/live/2018681/dasdingvr/master.m3u8'
    ),

    // Private Deutsche Sender & Free-TV Online-Streams
    makeChannel(
      'rtl-hd',
      'RTL HD',
      'private_de',
      'Vollprogramm',
      '192.168.178.110',
      8501,
      '/live/rtl-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_rtl_ger_tizen/playlist.m3u8'
    ),
    makeChannel(
      'sat1-hd',
      'SAT.1 HD',
      'private_de',
      'Vollprogramm',
      '192.168.178.110',
      8502,
      '/live/sat1-hd',
      'Full HD',
      'http',
      undefined,
      'Lokaler Heimnetz-Gateway — optional mit eigener Upstream-URL verknüpfen'
    ),
    makeChannel(
      'prosieben-hd',
      'ProSieben HD',
      'private_de',
      'Vollprogramm',
      '192.168.178.110',
      8503,
      '/live/prosieben-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_pro_sieben_tizen/playlist.m3u8'
    ),
    makeChannel(
      'vox-hd',
      'VOX HD',
      'private_de',
      'Unterhaltung',
      '192.168.178.110',
      8504,
      '/live/vox-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_vox_tizen/playlist.m3u8'
    ),
    makeChannel(
      'kabel-eins',
      'Kabel Eins HD',
      'private_de',
      'Filme & Serien',
      '192.168.178.110',
      8505,
      '/live/kabel-eins',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_kabel_eins_tizen/playlist.m3u8'
    ),
    makeChannel(
      'rtl-zwei',
      'RTLZWEI HD',
      'private_de',
      'Unterhaltung',
      '192.168.178.110',
      8506,
      '/live/rtl2-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_rtl_zwei_tizen/playlist.m3u8'
    ),
    makeChannel(
      'sixx-hd',
      'sixx HD',
      'private_de',
      'Serien',
      '192.168.178.110',
      8507,
      '/live/sixx-hd',
      'HD',
      'http',
      'https://dash4.antik.sk/live/test_sixx_tizen/playlist.m3u8'
    ),
    makeChannel(
      'prosieben-maxx',
      'ProSieben MAXX HD',
      'private_de',
      'Sport & Anime',
      '192.168.178.110',
      8508,
      '/live/pro7-maxx',
      'Full HD',
      'http',
      'https://s6.hopslan.com/pro7maxxX/index.m3u8'
    ),
    makeChannel(
      'sport1-hd',
      'SPORT1 HD',
      'private_de',
      'Sport & Live',
      '192.168.178.110',
      8509,
      '/live/sport1-hd',
      'Full HD',
      'http',
      undefined,
      'Lokaler Heimnetz-Gateway — optional mit eigener Upstream-URL verknüpfen'
    ),
    makeChannel(
      'eurosport1-de',
      'Eurosport 1 Deutschland HD',
      'private_de',
      'Sport & Live',
      '192.168.178.110',
      8510,
      '/live/eurosport1-de',
      'Full HD',
      'http',
      'http://90.183.52.46:4000/play/a06v/index.m3u8'
    ),
    makeChannel(
      'ntv-hd',
      'n-tv HD',
      'private_de',
      'Nachrichten',
      '192.168.178.110',
      8511,
      '/live/ntv-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_ntv_tizen/playlist.m3u8'
    ),
    makeChannel(
      'welt-hd',
      'WELT HD',
      'private_de',
      'Nachrichten & Doku',
      '192.168.178.110',
      8512,
      '/live/welt-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_welt_tizen/playlist.m3u8'
    ),
    makeChannel(
      'dmax-hd',
      'DMAX HD',
      'private_de',
      'Dokumentation',
      '192.168.178.110',
      8513,
      '/live/dmax-hd',
      'Full HD',
      'http',
      'https://s6.hopslan.com/dmaxX/index.m3u8'
    ),
    makeChannel(
      'sat1-gold-hd',
      'SAT.1 Gold HD',
      'private_de',
      'Serien & Unterhaltung',
      '192.168.178.110',
      8514,
      '/live/sat1-gold',
      'HD',
      'http',
      'https://dash4.antik.sk/live/test_sat_eins_gold_tizen/playlist.m3u8'
    ),
    makeChannel(
      'deluxe-music-hd',
      'DELUXE MUSIC HD',
      'private_de',
      'Musik',
      '192.168.178.110',
      8515,
      '/live/deluxe-music',
      'Full HD',
      'http',
      'https://sdn-global-live-streaming-packager-cache.3qsdn.com/13456/13456_264_live.m3u8'
    ),
    makeChannel(
      'deluxe-lounge-hd',
      'Deluxe Lounge HD',
      'private_de',
      'Musik',
      '192.168.178.110',
      8516,
      '/live/deluxe-lounge',
      'Full HD',
      'http',
      'https://jmp2.uk/stvp-CHAJ0500413A'
    ),
    makeChannel(
      'xite-hits-de',
      'XITE Hits Germany HD',
      'private_de',
      'Musik',
      '192.168.178.110',
      8517,
      '/live/xite-hits-de',
      'Full HD',
      'http',
      'https://d726x48n2pd5h.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-skxr1pazhltvp/XITE_Hits.m3u8'
    ),
    makeChannel(
      'n24-doku-hd',
      'N24 Doku HD',
      'private_de',
      'Dokumentation',
      '192.168.178.110',
      8518,
      '/live/n24-doku',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-60080e8a4bf36000076a81b1.m3u8'
    ),
    makeChannel(
      'welt-der-wunder-tv',
      'Welt der Wunder TV',
      'private_de',
      'Wissen & Doku',
      '192.168.178.110',
      8519,
      '/live/welt-der-wunder',
      'HD',
      'http',
      'https://wdw.iptv-playoutcenter.de/wdw/wdw1/playlist.m3u8'
    ),
    makeChannel(
      'zee-one-de',
      'Zee One Deutsch HD',
      'private_de',
      'Kino & Unterhaltung',
      '192.168.178.110',
      8520,
      '/live/zee-one-de',
      'Full HD',
      'http',
      'https://e4955b54.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/U2Ftc3VuZy1kZV9aZWVPbmVfSExT/playlist.m3u8'
    ),
    makeChannel(
      'tele5-de',
      'TELE 5 HD',
      'private_de',
      'Kino & Sci-Fi',
      '192.168.178.110',
      8521,
      '/live/tele5-de',
      'Full HD',
      'http',
      'https://s6.hopslan.com/tele5X/index.m3u8'
    ),
    makeChannel(
      'nitro-hd',
      'NITRO HD',
      'private_de',
      'Krimi & Action',
      '192.168.178.110',
      8522,
      '/live/nitro-hd',
      'Full HD',
      'http',
      'https://dash4.antik.sk/live/test_rtl_nitro_tizen/playlist.m3u8'
    ),
    makeChannel(
      'rtl-super',
      'RTL Super HD',
      'private_de',
      'Kinder & Familie',
      '192.168.178.110',
      8523,
      '/live/rtl-super',
      'Full HD',
      'http',
      'https://s6.hopslan.com/superX/index.m3u8'
    ),
    makeChannel(
      'rtlup-hd',
      'RTLup HD',
      'private_de',
      'Unterhaltung',
      '192.168.178.110',
      8524,
      '/live/rtlup-hd',
      'Full HD',
      'http',
      'https://s6.hopslan.com/rtltupz/index.m3u8'
    ),
    makeChannel(
      'voxup-hd',
      'VOXup HD',
      'private_de',
      'Unterhaltung',
      '192.168.178.110',
      8525,
      '/live/voxup-hd',
      'Full HD',
      'http',
      'https://s6.hopslan.com/voxupz/index.m3u8'
    ),
    makeChannel(
      'kabel-eins-doku',
      'kabel eins Doku HD',
      'private_de',
      'Dokumentation',
      '192.168.178.110',
      8526,
      '/live/kabel-eins-doku',
      'Full HD',
      'http',
      'https://s6.hopslan.com/dokuX/index.m3u8'
    ),
    makeChannel(
      'comedy-central-de',
      'Comedy Central DE HD',
      'private_de',
      'Comedy',
      '192.168.178.110',
      8527,
      '/live/comedy-central-de',
      'Full HD',
      'http',
      'https://ma.anixa.tv/clips/stream/comedy_central/playlist.php'
    ),
    makeChannel(
      'mtv-de',
      'MTV Germany HD',
      'private_de',
      'Musik & Show',
      '192.168.178.110',
      8528,
      '/live/mtv-de',
      'Full HD',
      'http',
      'https://ma.anixa.tv/clips/stream/mtv/playlist.php'
    ),
    makeChannel(
      'nickelodeon-de',
      'Nickelodeon DE HD',
      'private_de',
      'Kinder',
      '192.168.178.110',
      8529,
      '/live/nickelodeon-de',
      'Full HD',
      'http',
      'https://ma.anixa.tv/clips/stream/nickelodeon/playlist.php'
    ),
    makeChannel(
      'more-than-sports-tv',
      'More Than Sports TV HD',
      'private_de',
      'Sport & Live',
      '192.168.178.110',
      8530,
      '/live/more-than-sports',
      'Full HD',
      'http',
      'https://mts1.iptv-playoutcenter.de/mts/mts-web/playlist.m3u8'
    ),
    makeChannel(
      'dokusat-hd',
      'Dokusat HD',
      'private_de',
      'Dokumentation',
      '192.168.178.110',
      8531,
      '/live/dokusat-hd',
      'Full HD',
      'http',
      'https://muc3.iptv-playoutcenter.de/dokusat/dokusat1/playlist.m3u8'
    ),
    makeChannel(
      'deluxe-rap-hd',
      'Deluxe Rap HD',
      'private_de',
      'Musik',
      '192.168.178.110',
      8532,
      '/live/deluxe-rap',
      'Full HD',
      'http',
      'https://sdn-global-live-streaming-packager-cache.3qsdn.com/65183/65183_264_live.m3u8'
    ),
    makeChannel(
      'dmf-tv-hd',
      'Deutsches Musik Fernsehen (DMF)',
      'private_de',
      'Musik',
      '192.168.178.110',
      8533,
      '/live/dmf-tv',
      'Full HD',
      'http',
      'https://d-m-f.iptv-playoutcenter.de/dmf/dmf1/playlist.m3u8'
    ),
    makeChannel(
      'allgaeu-tv-hd',
      'Allgäu TV HD',
      'private_de',
      'Regional',
      '192.168.178.110',
      8534,
      '/live/allgaeu-tv',
      'Full HD',
      'http',
      'https://stream01.welocal.stream/stream/fhd-allgaeutv_25679/ngrp:stream_all/playlist.m3u8'
    ),
    makeChannel(
      'augsburg-tv-hd',
      'Augsburg TV HD',
      'private_de',
      'Regional',
      '192.168.178.110',
      8535,
      '/live/augsburg-tv',
      'Full HD',
      'http',
      'https://stream02.welocal.stream/stream/fhd-augsburgtv_104951/ngrp:stream_all/playlist.m3u8'
    ),

    // Kostenlose Live-TV Sport, Film & Doku Kanäle (Eigene / FAST Online)
    makeChannel(
      'red-bull-tv-de',
      'Red Bull TV DE',
      'custom',
      'Sport & Action',
      '192.168.178.130',
      8601,
      '/live/red-bull-tv-de',
      'Full HD',
      'http',
      'https://46cfeb23c7f74853bba7a256655a3119.mediatailor.us-west-2.amazonaws.com/v1/master/ba62fe743df0fe93366eba3a257d792884136c7f/LINEAR-582-WORBDACHDEFAST-WHALETVPLUS/582/whaletvplus/hls/master/playlist.m3u8'
    ),
    makeChannel(
      'world-of-freesports',
      'World of Freesports HD',
      'custom',
      'Sport & Action',
      '192.168.178.130',
      8602,
      '/live/world-of-freesports',
      'Full HD',
      'http',
      'https://mainstreammedia-worldoffreesportsintl-rakuten.amagi.tv/playlist.m3u8'
    ),
    makeChannel(
      'dazn-darts-pluto',
      'DAZN Darts x Pluto TV',
      'custom',
      'Sport & Live',
      '192.168.178.130',
      8603,
      '/live/dazn-darts',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-64b67f0424ade50008a3be17.m3u8'
    ),
    makeChannel(
      'dazn-heldinnen-pluto',
      'DAZN Heldinnen x Pluto TV',
      'custom',
      'Sport & Live',
      '192.168.178.130',
      8604,
      '/live/dazn-heldinnen',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-64afe50c5dc16600087f3227.m3u8'
    ),
    makeChannel(
      'terra-mater-wild',
      'Terra Mater WILD HD',
      'custom',
      'Natur & Doku',
      '192.168.178.130',
      8605,
      '/live/terra-mater-wild',
      'Full HD',
      'http',
      'https://53ff3982.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmxheHhUVi1ldV9UZXJyYU1hdGVyV2lsZF9ITFM/playlist.m3u8'
    ),
    makeChannel(
      'autentic-travel-de',
      'Autentic Travel HD',
      'custom',
      'Reisen & Doku',
      '192.168.178.130',
      8606,
      '/live/autentic-travel',
      'Full HD',
      'http',
      'https://0876432b34c349e6b4f3a18df2213adc.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticTravel/playlist.m3u8'
    ),
    makeChannel(
      'autentic-history-de',
      'Autentic History HD',
      'custom',
      'Geschichte & Doku',
      '192.168.178.130',
      8607,
      '/live/autentic-history',
      'Full HD',
      'http',
      'https://9e754fa707344ccca6d84955c8fcaf36.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AutenticHistory/playlist.m3u8'
    ),
    makeChannel(
      'curiosity-channel-de',
      'Curiosity Channel DE',
      'custom',
      'Wissen & Doku',
      '192.168.178.130',
      8608,
      '/live/curiosity-channel',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-6576c20fb3801200084786c9.m3u8'
    ),
    makeChannel(
      'pluto-tv-kultfilme',
      'Pluto TV Kultfilme DE',
      'custom',
      'Kino & Filme',
      '192.168.178.130',
      8609,
      '/live/pluto-kultfilme',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5dde47b63585b500099f74ec.m3u8'
    ),
    makeChannel(
      'pluto-tv-movies',
      'Pluto TV Movies DE',
      'custom',
      'Kino & Filme',
      '192.168.178.130',
      8610,
      '/live/pluto-movies',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5c5c3b948002db3c3e0b262e.m3u8'
    ),
    makeChannel(
      'moviedome-de',
      'Moviedome DE HD',
      'custom',
      'Kino & Filme',
      '192.168.178.130',
      8611,
      '/live/moviedome-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-615c1e5ce3039400070a0547.m3u8'
    ),
    makeChannel(
      'pluto-tv-crime',
      'Pluto TV Crime DE',
      'custom',
      'Krimi & Thriller',
      '192.168.178.130',
      8612,
      '/live/pluto-crime',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5e7b6c60fd20c50007910bf5.m3u8'
    ),
    makeChannel(
      'pluto-tv-nature',
      'Pluto TV Nature DE',
      'custom',
      'Natur & Doku',
      '192.168.178.130',
      8613,
      '/live/pluto-nature',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5be1c3f9851dd5632e2c91b2.m3u8'
    ),
    makeChannel(
      'pluto-tv-comedy-de',
      'Pluto TV Deutsche Comedy',
      'custom',
      'Comedy',
      '192.168.178.130',
      8614,
      '/live/pluto-comedy-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-6672f49f61a39900089db68e.m3u8'
    ),
    makeChannel(
      'star-trek-tng-de',
      'Star Trek: The Next Generation DE',
      'custom',
      'Sci-Fi & Serien',
      '192.168.178.130',
      8615,
      '/live/star-trek-tng-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-69776ce979545c21a1220bff.m3u8'
    ),
    makeChannel(
      'naruto-de',
      'Naruto Germany HD',
      'custom',
      'Anime & Serien',
      '192.168.178.130',
      8616,
      '/live/naruto-de',
      'HD',
      'http',
      'https://jmp2.uk/plu-65d5fc39a25d5e00082895c4.m3u8'
    ),
    makeChannel(
      'spongebob-de',
      'SpongeBob Schwammkopf DE',
      'custom',
      'Kinder',
      '192.168.178.130',
      8617,
      '/live/spongebob-de',
      'HD',
      'http',
      'https://jmp2.uk/plu-5d00e8adaab96b5635b2a005.m3u8'
    ),
    // Österreich & Schweiz (AT & CH - DACH Live-Streams)
    makeChannel(
      'orf1-hd',
      'ORF 1 HD (AT)',
      'at_ch',
      'Vollprogramm',
      '192.168.178.155',
      8701,
      '/live/orf1-hd',
      'Full HD',
      'http',
      'https://test02.mdn.ors.at/orf/orf1/qxa/manifest.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'orf2-hd',
      'ORF 2 HD (AT)',
      'at_ch',
      'Vollprogramm',
      '192.168.178.155',
      8702,
      '/live/orf2-hd',
      'HD',
      'http',
      'http://88.212.7.14/live/test_orf_zwei_tizen/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'orf3-hd',
      'ORF III HD (AT)',
      'at_ch',
      'Kultur & Doku',
      '192.168.178.155',
      8703,
      '/live/orf3-hd',
      'Full HD',
      'http',
      'https://orf3.mdn.ors.at/orf/orf3/qxa/manifest.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'orfsport-hd',
      'ORF Sport+ HD (AT)',
      'at_ch',
      'Sport & Live',
      '192.168.178.155',
      8704,
      '/live/orfsport-hd',
      'Full HD',
      'http',
      'https://test02.mdn.ors.at/orf/orfs/qxa/manifest.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'okto-tv-wien',
      'Okto TV Wien HD (AT)',
      'at_ch',
      'Regional & Kultur',
      '192.168.178.155',
      8705,
      '/live/okto-tv-wien',
      'Full HD',
      'http',
      'https://cdn3.wowza.com/1/MHFtazJReW5rOFhP/N2NWNDZ2/hls/live/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'kronehit-tv-at',
      'Kronehit TV HD (AT)',
      'at_ch',
      'Musik',
      '192.168.178.155',
      8706,
      '/live/kronehit-tv',
      'Full HD',
      'http',
      'https://bitcdn-kronehit.bitmovin.com/v2/hls/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'tv1-oberoesterreich',
      'TV1 Oberösterreich HD (AT)',
      'at_ch',
      'Regional',
      '192.168.178.155',
      8707,
      '/live/tv1-ooe',
      'Full HD',
      'http',
      'https://streaming10.huberwebmedia.at/LiveApp/streams/238985177034727564068269_adaptive.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'schladming-tv',
      'Schladming-Dachstein TV (AT)',
      'at_ch',
      'Regional & Tourismus',
      '192.168.178.155',
      8708,
      '/live/schladming-tv',
      'HD',
      'http',
      'https://m317.video-stream-hosting.de/gzSoftware-live/_definst_/smil:livestream.smil/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'antenne-steiermark',
      'Antenne Steiermark (AT)',
      'at_ch',
      'Musik & Regional',
      '192.168.178.155',
      8709,
      '/live/antenne-steiermark',
      'HD',
      'http',
      'https://60efd7a2b4d02.streamlock.net/a_steiermark/ngrp:livestream_all/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'antenne-kaernten',
      'Antenne Kärnten (AT)',
      'at_ch',
      'Musik & Regional',
      '192.168.178.155',
      8710,
      '/live/antenne-kaernten',
      'HD',
      'http',
      'https://60efd7a2b4d02.streamlock.net/a_kaernten/ngrp:livestream_all/playlist.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'ktv-at',
      'K-TV HD (AT/CH)',
      'at_ch',
      'Kultur & Kirche',
      '192.168.178.155',
      8711,
      '/live/ktv-at',
      'HD',
      'http',
      'https://d1pz8zear993v8.cloudfront.net/hlsme/kathtv.m3u8',
      undefined,
      'Deutsch (AT)'
    ),
    makeChannel(
      'meteonews-ch',
      'Meteonews TV HD (CH)',
      'at_ch',
      'Wetter & News',
      '192.168.178.155',
      8712,
      '/live/meteonews-ch',
      'Full HD',
      'http',
      'https://streaming.meteonews.net/hls/stream.m3u8',
      undefined,
      'Deutsch (CH)'
    ),
    makeChannel(
      'teleticino-ch',
      'TeleTicino HD (CH)',
      'at_ch',
      'Regional & News',
      '192.168.178.155',
      8713,
      '/live/teleticino-ch',
      'HD',
      'http',
      'https://vstream-cdn.ch/hls/teleticino.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'carac1-ch',
      'Carac 1 HD (CH)',
      'at_ch',
      'Vollprogramm',
      '192.168.178.155',
      8714,
      '/live/carac1-ch',
      'Full HD',
      'http',
      'https://edge13.vedge.infomaniak.com/livecast/ik:event/manifest.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'carac2-ch',
      'Carac 2 HD (CH)',
      'at_ch',
      'Musik & Unterhaltung',
      '192.168.178.155',
      8715,
      '/live/carac2-ch',
      'Full HD',
      'http',
      'https://onefmhd.vedge.infomaniak.com/livecast/ik:onefmhd/manifest.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'carac3-ch',
      'Carac 3 HD (CH)',
      'at_ch',
      'Musik & Radio TV',
      '192.168.178.155',
      8716,
      '/live/carac3-ch',
      'Full HD',
      'http',
      'https://lfmhd.vedge.infomaniak.com/livecast/lfmhd/playlist.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'canal-alpha-ch',
      'Canal Alpha Jura HD (CH)',
      'at_ch',
      'Regional',
      '192.168.178.155',
      8717,
      '/live/canal-alpha-ch',
      'Full HD',
      'http',
      'https://canalalphaju.vedge.infomaniak.com/livecast/ik:canalalphaju/playlist.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'radio-3i-ch',
      'Radio 3i TV (CH)',
      'at_ch',
      'Musik',
      '192.168.178.155',
      8718,
      '/live/radio-3i-ch',
      'HD',
      'http',
      'https://vstream-cdn.ch/hls/radio3i.m3u8',
      undefined,
      'Schweiz (CH)'
    ),
    makeChannel(
      'rakuten-action-de',
      'Rakuten TV Action Movies DE',
      'custom',
      'Kino & Action',
      '192.168.178.130',
      8618,
      '/live/rakuten-action-de',
      'Full HD',
      'http',
      'https://284824cf70404fdfb6ddf9349009c710.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6066/master.m3u8'
    ),
    makeChannel(
      'rakuten-comedy-de',
      'Rakuten TV Comedy Movies DE',
      'custom',
      'Comedy & Kino',
      '192.168.178.130',
      8619,
      '/live/rakuten-comedy-de',
      'Full HD',
      'http',
      'https://ecac08c9e2214375b907d6825aaf9a01.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6182/master.m3u8'
    ),
    makeChannel(
      'rakuten-drama-de',
      'Rakuten TV Drama Movies DE',
      'custom',
      'Kino & Drama',
      '192.168.178.130',
      8620,
      '/live/rakuten-drama-de',
      'Full HD',
      'http',
      'https://968754c2483045c1a9a7f677caec35b6.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6096/master.m3u8'
    ),
    makeChannel(
      'rakuten-family-de',
      'Rakuten TV Family Movies DE',
      'custom',
      'Kinder & Familie',
      '192.168.178.130',
      8621,
      '/live/rakuten-family-de',
      'Full HD',
      'http',
      'https://af230031eeac45f3b78d4f8a13265105.mediatailor.eu-west-1.amazonaws.com/v1/master/0547f18649bd788bec7b67b746e47670f558b6b2/production-LiveChannel-6209/master.m3u8'
    ),
    makeChannel(
      'adventure-earth-hd',
      'Adventure Earth HD (DE)',
      'custom',
      'Natur & Doku',
      '192.168.178.130',
      8622,
      '/live/adventure-earth-de',
      'Full HD',
      'http',
      'https://a57e9c69976649b582a8d7604c00e69a.mediatailor.us-east-1.amazonaws.com/v1/master/44f73ba4d03e9607dcd9bebdcb8494d86964f1d8/RlaxxTV-eu_AdventureEarth/playlist.m3u8'
    ),
    makeChannel(
      'folx-music-tv',
      'Folx Music Television HD',
      'custom',
      'Musik',
      '192.168.178.130',
      8623,
      '/live/folx-music',
      'Full HD',
      'http',
      'https://folxapp.b-cdn.net/1080p/index.m3u8'
    ),
    makeChannel(
      'one-music-tv',
      'One Music Television HD',
      'custom',
      'Musik',
      '192.168.178.130',
      8624,
      '/live/one-music',
      'Full HD',
      'http',
      'https://oneapp.b-cdn.net/1080p/index.m3u8'
    ),
    makeChannel(
      'zwei-music-tv',
      'Zwei Music Television HD',
      'custom',
      'Musik',
      '192.168.178.130',
      8625,
      '/live/zwei-music',
      'Full HD',
      'http',
      'https://zweiapp.b-cdn.net/1080p/index.m3u8'
    ),
    makeChannel(
      'fifa-plus-de',
      'FIFA+ German HD',
      'custom',
      'Sport & Live',
      '192.168.178.130',
      8626,
      '/live/fifa-plus-de',
      'HD',
      'http',
      'https://4397879b.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/UmFrdXRlblRWLWRlX0ZJRkFQbHVzR2VybWFuX0hMUw/playlist.m3u8'
    ),
    makeChannel(
      'strongman-de',
      'Strongman Champions League',
      'custom',
      'Sport & Action',
      '192.168.178.130',
      8627,
      '/live/strongman-de',
      'Full HD',
      'http',
      'https://rightsboosterltd-scl-2-eu.rakuten.wurl.tv/playlist.m3u8'
    ),
    makeChannel(
      'wpt-germany',
      'World Poker Tour Germany',
      'custom',
      'Sport & Action',
      '192.168.178.130',
      8628,
      '/live/wpt-germany',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5ad9b7aae738977e2c312132.m3u8'
    ),
    makeChannel(
      'volksmusik-tv',
      'Volksmusik TV',
      'custom',
      'Musik',
      '192.168.178.130',
      8629,
      '/live/volksmusik-tv',
      'Full HD',
      'http',
      'https://vmtv.iptv-playoutcenter.de/vmtv/vmtv1/playlist.m3u8'
    ),
    makeChannel(
      'adria-music-tv',
      'Adria Music Television HD',
      'custom',
      'Musik',
      '192.168.178.130',
      8630,
      '/live/adria-music-tv',
      'Full HD',
      'http',
      'https://adriaapp.b-cdn.net/1080p/index.m3u8'
    ),
    makeChannel(
      'bbc-travel-de',
      'BBC Travel DE',
      'custom',
      'Reisen & Doku',
      '192.168.178.130',
      8631,
      '/live/bbc-travel-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-60e4519e6873180007d3cddb.m3u8'
    ),
    makeChannel(
      'wedo-big-stories',
      'Wedo Big Stories HD',
      'custom',
      'Wissen & Doku',
      '192.168.178.130',
      8632,
      '/live/wedo-big-stories',
      'Full HD',
      'http',
      'https://amg00735-videosolutionsa-wedobigdocs-ono-0urlz.amagi.tv/playlist/amg00735-videosolutionsa-wedobigdocs-ono/playlist.m3u8'
    ),
    makeChannel(
      'pluto-tv-animals',
      'Pluto TV Animals DE',
      'custom',
      'Natur & Doku',
      '192.168.178.130',
      8633,
      '/live/pluto-animals-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5d767ae7b456c8cf265ce922.m3u8'
    ),
    makeChannel(
      'pluto-tv-explore',
      'Pluto TV Explore DE',
      'custom',
      'Wissen & Doku',
      '192.168.178.130',
      8634,
      '/live/pluto-explore-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5ad9b8551b95267e225e59c1.m3u8'
    ),
    makeChannel(
      'pluto-tv-space',
      'Pluto TV Space DE',
      'custom',
      'Wissen & Doku',
      '192.168.178.130',
      8635,
      '/live/pluto-space-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-61409f8d6feb30000766b675.m3u8'
    ),
    makeChannel(
      'pluto-tv-mystery',
      'Pluto TV Mystery DE',
      'custom',
      'Dokumentation',
      '192.168.178.130',
      8636,
      '/live/pluto-mystery-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-617aad99b68ef100072608cd.m3u8'
    ),
    makeChannel(
      'pluto-tv-food',
      'Pluto TV Food DE',
      'custom',
      'Kochen & Doku',
      '192.168.178.130',
      8637,
      '/live/pluto-food-de',
      'Full HD',
      'http',
      'https://jmp2.uk/plu-5dc280c9aa218c0009724b4b.m3u8'
    ),
    makeChannel(
      'waterbear-doc',
      'WaterBear HD (Natur-Doku)',
      'custom',
      'Natur & Doku',
      '192.168.178.130',
      8638,
      '/live/waterbear-doc',
      'Full HD',
      'http',
      'https://amg01415-waterbearnetwor-waterbear-samsunguk-1h0y8.amagi.tv/playlist/amg01415-waterbearnetwor-waterbear-samsunguk/playlist.m3u8'
    ),

    // Sky Deutschland (Lokale Heimnetz-Gateways)
    makeChannel('sky-bundesliga-1', 'Sky Sport Bundesliga 1 HD', 'sky', 'Sport & Live', '192.168.178.50', 8001, '/live/sky-bundesliga-1', '4K UHD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM) — eigene Upstream-URL optional'),
    makeChannel('sky-bundesliga-2', 'Sky Sport Bundesliga 2 HD', 'sky', 'Sport & Live', '192.168.178.50', 8002, '/live/sky-bundesliga-2', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-sport-top-event', 'Sky Sport Top Event', 'sky', 'Sport & Live', '192.168.178.50', 8003, '/live/sky-top-event', '4K UHD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-sport-f1', 'Sky Sport F1 HD', 'sky', 'Motorsport', '192.168.178.50', 8004, '/live/sky-f1', '4K UHD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-cinema-premieren', 'Sky Cinema Premieren HD', 'sky', 'Kino & Filme', '192.168.178.50', 8005, '/live/sky-cinema-premieren', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-atlantic', 'Sky Atlantic HD', 'sky', 'Serien', '192.168.178.50', 8006, '/live/sky-atlantic', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-one', 'Sky One HD', 'sky', 'Unterhaltung', '192.168.178.50', 8007, '/live/sky-one', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-krimi', 'Sky Krimi HD', 'sky', 'Krimi & Thriller', '192.168.178.50', 8008, '/live/sky-krimi', 'HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-documentaries', 'Sky Documentaries HD', 'sky', 'Dokumentation', '192.168.178.50', 8009, '/live/sky-docs', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),
    makeChannel('sky-nature', 'Sky Nature HD', 'sky', 'Natur & Doku', '192.168.178.50', 8010, '/live/sky-nature', '4K UHD', 'http', undefined, 'Lokaler Heimnetz-Gateway (Pay-TV/DRM)'),

    // Netflix DE (Lokale Heimnetz-Gateways)
    makeChannel('netflix-de-main', 'Netflix DE Gateway (4K)', 'netflix', 'Streaming Hub', '192.168.178.60', 8101, '/stream/netflix-de-4k', '4K UHD', 'https', undefined, 'Zentraler Proxy-Endpunkt für Netflix DE (Heimnetz)'),
    makeChannel('netflix-de-serien', 'Netflix DE Serien-Feed', 'netflix', 'Serien', '192.168.178.60', 8102, '/stream/netflix-serien', 'Full HD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),
    makeChannel('netflix-de-filme', 'Netflix DE Kino-Feed', 'netflix', 'Kino & Filme', '192.168.178.60', 8103, '/stream/netflix-filme', '4K UHD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),
    makeChannel('netflix-de-kids', 'Netflix DE Kinder & Familie', 'netflix', 'Kinder', '192.168.178.60', 8104, '/stream/netflix-kids', 'Full HD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),

    // Amazon Prime Video (Lokale Heimnetz-Gateways)
    makeChannel('amazon-prime-main', 'Amazon Prime Video DE (4K)', 'amazon', 'Streaming Hub', '192.168.178.70', 8201, '/stream/prime-de-4k', '4K UHD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),
    makeChannel('amazon-prime-sport', 'Prime Video Champions League', 'amazon', 'Sport & Live', '192.168.178.70', 8202, '/stream/prime-ucl-live', '4K UHD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),
    makeChannel('amazon-prime-cinema', 'Prime Video Store & Filme', 'amazon', 'Kino & Filme', '192.168.178.70', 8203, '/stream/prime-cinema', 'Full HD', 'https', undefined, 'Lokaler Heimnetz-Gateway'),
    makeChannel('amazon-freevee', 'Amazon Freevee DE Live', 'amazon', 'Unterhaltung', '192.168.178.70', 8204, '/stream/freevee-de', 'Full HD', 'http', undefined, 'Lokaler Heimnetz-Gateway'),

    // Disney+ & Disney Channel DE
    makeChannel(
      'disney-channel-de',
      'Disney Channel DE HD',
      'disney',
      'Kinder & Familie',
      '192.168.178.80',
      8300,
      '/stream/disney-channel-de',
      'Full HD',
      'http',
      'https://s6.hopslan.com/disneyX/index.m3u8'
    ),
    makeChannel('disney-plus-main', 'Disney+ DE Haupt-Stream', 'disney', 'Streaming Hub', '192.168.178.80', 8301, '/stream/disney-de-4k', '4K UHD', 'https', undefined, 'Lokaler Heimnetz-Gateway (DRM)'),
    makeChannel('disney-marvel-starwars', 'Disney+ Marvel & Star Wars', 'disney', 'Kino & Filme', '192.168.178.80', 8302, '/stream/disney-marvel-sw', '4K UHD', 'https', undefined, 'Lokaler Heimnetz-Gateway (DRM)'),
    makeChannel('disney-star-de', 'Disney+ Star DE (Serien)', 'disney', 'Serien', '192.168.178.80', 8303, '/stream/disney-star', 'Full HD', 'https', undefined, 'Lokaler Heimnetz-Gateway (DRM)'),
    makeChannel('disney-natgeo', 'National Geographic DE', 'disney', 'Dokumentation', '192.168.178.80', 8304, '/stream/natgeo-de', 'Full HD', 'https', undefined, 'Lokaler Heimnetz-Gateway (DRM)'),
  ];

  const playlists: Playlist[] = [
    {
      id: 'pl-komplett-de',
      name: 'Wohnzimmer Komplett (DE)',
      description:
        'Direkt abspielbare deutsche Live-TV-Sender kombiniert mit Doku-, Musik- und Film-Streams.',
      channelIds: [
        'das-erste',
        'zdf-hd',
        'rtl-hd',
        'prosieben-hd',
        'vox-hd',
        'kabel-eins',
        'arte-de',
        'dreisat',
        'phoenix',
        'tagesschau24',
        'welt-hd',
        'ntv-hd',
        'orf1-hd',
        'orf2-hd',
        'deluxe-music-hd',
        'red-bull-tv-de',
        'fifa-plus-de',
        'pluto-tv-kultfilme',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-online-live-de',
      name: 'Live-TV & Free-Streams Online (DE)',
      description:
        'Alle sofort online abspielbaren deutschen TV-, Nachrichten-, Sport-, Doku- und Musiksender.',
      channelIds: [
        'das-erste',
        'zdf-hd',
        'zdf-neo',
        'zdf-info',
        'arte-de',
        'dreisat',
        'phoenix',
        'tagesschau24',
        'kika',
        'one-hd-ard',
        'ard-alpha-hd',
        'wdr-hd',
        'br-hd',
        'ndr-hd',
        'swr-hd',
        'mdr-hd',
        'hr-fernsehen-hd',
        'rbb-berlin-hd',
        'sr-fernsehen-hd',
        'radio-bremen-tv',
        'dw-deutsch-hd',
        'alex-berlin-hd',
        'dasding-tv',
        'rtl-hd',
        'prosieben-hd',
        'vox-hd',
        'kabel-eins',
        'rtl-zwei',
        'sixx-hd',
        'sat1-gold-hd',
        'ntv-hd',
        'welt-hd',
        'prosieben-maxx',
        'dmax-hd',
        'eurosport1-de',
        'disney-channel-de',
        'tele5-de',
        'nitro-hd',
        'rtl-super',
        'rtlup-hd',
        'voxup-hd',
        'kabel-eins-doku',
        'comedy-central-de',
        'mtv-de',
        'nickelodeon-de',
        'more-than-sports-tv',
        'dokusat-hd',
        'deluxe-music-hd',
        'deluxe-rap-hd',
        'dmf-tv-hd',
        'allgaeu-tv-hd',
        'augsburg-tv-hd',
        'xite-hits-de',
        'red-bull-tv-de',
        'world-of-freesports',
        'dazn-darts-pluto',
        'fifa-plus-de',
        'strongman-de',
        'n24-doku-hd',
        'welt-der-wunder-tv',
        'terra-mater-wild',
        'wedo-big-stories',
        'bbc-travel-de',
        'zee-one-de',
        'pluto-tv-kultfilme',
        'moviedome-de',
        'rakuten-action-de',
        'rakuten-comedy-de',
        'orf1-hd',
        'orfsport-hd',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-dach-at-ch',
      name: 'Österreich & Schweiz (DACH Live)',
      description:
        'Direkt abspielbare Online-TV- und Musiksender aus Österreich (ORF, Kronehit, Okto, TV1) und der Schweiz (Carac, Meteonews, TeleTicino).',
      channelIds: [
        'orf1-hd',
        'orf2-hd',
        'orf3-hd',
        'orfsport-hd',
        'okto-tv-wien',
        'kronehit-tv-at',
        'tv1-oberoesterreich',
        'schladming-tv',
        'antenne-steiermark',
        'antenne-kaernten',
        'ktv-at',
        'meteonews-ch',
        'teleticino-ch',
        'carac1-ch',
        'carac2-ch',
        'carac3-ch',
        'canal-alpha-ch',
        'radio-3i-ch',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-sport-musik-doku',
      name: 'Sport, Musik & Doku (Online)',
      description:
        'Kuratierte Themensender für Sport (FIFA+, Red Bull TV, DAZN Pluto, ORF Sport+), Musik (Deluxe, MTV, XITE, DMF, Kronehit) & Dokus (Terra Mater, BBC Travel, Wedo, Pluto).',
      channelIds: [
        'fifa-plus-de',
        'red-bull-tv-de',
        'world-of-freesports',
        'dazn-darts-pluto',
        'dazn-heldinnen-pluto',
        'more-than-sports-tv',
        'eurosport1-de',
        'strongman-de',
        'wpt-germany',
        'orfsport-hd',
        'deluxe-music-hd',
        'deluxe-lounge-hd',
        'deluxe-rap-hd',
        'xite-hits-de',
        'mtv-de',
        'folx-music-tv',
        'one-music-tv',
        'zwei-music-tv',
        'volksmusik-tv',
        'dmf-tv-hd',
        'dasding-tv',
        'adria-music-tv',
        'kronehit-tv-at',
        'terra-mater-wild',
        'wedo-big-stories',
        'bbc-travel-de',
        'autentic-travel-de',
        'autentic-history-de',
        'curiosity-channel-de',
        'n24-doku-hd',
        'welt-der-wunder-tv',
        'dokusat-hd',
        'kabel-eins-doku',
        'pluto-tv-nature',
        'pluto-tv-animals',
        'pluto-tv-explore',
        'pluto-tv-space',
        'pluto-tv-mystery',
        'pluto-tv-food',
        'adventure-earth-hd',
        'waterbear-doc',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-oeffentlich-basis',
      name: 'Öffentlich-Rechtliche Basis',
      description:
        'ARD, ZDF, Kultur-, Nachrichten- und Regionalsender direkt per Live-HLS.',
      channelIds: [
        'das-erste',
        'zdf-hd',
        'zdf-neo',
        'zdf-info',
        'arte-de',
        'dreisat',
        'phoenix',
        'tagesschau24',
        'kika',
        'one-hd-ard',
        'ard-alpha-hd',
        'wdr-hd',
        'br-hd',
        'ndr-hd',
        'swr-hd',
        'mdr-hd',
        'hr-fernsehen-hd',
        'rbb-berlin-hd',
        'sr-fernsehen-hd',
        'radio-bremen-tv',
        'alex-berlin-hd',
        'orf1-hd',
        'orf3-hd',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-streaming-hubs',
      name: 'Streaming & Pay-TV Paket',
      description:
        'Disney Channel DE (Online-Live) sowie Heimnetz-Gateways für Sky, Netflix, Amazon Prime Video und Disney+.',
      channelIds: [
        'disney-channel-de',
        'sky-bundesliga-1',
        'sky-sport-f1',
        'sky-atlantic',
        'netflix-de-main',
        'netflix-de-serien',
        'amazon-prime-main',
        'amazon-prime-sport',
        'disney-plus-main',
        'disney-marvel-starwars',
      ],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-auto-quellen',
      name: 'Auto-Quellen Liste (DE)',
      description:
        'Wird automatisch mit neuen Online-Kanälen aus aktiven M3U-Quellen befüllt und aktuell gehalten.',
      channelIds: [],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    {
      id: 'pl-iptv-org-dach',
      name: 'IPTV-org DACH (Live-Import)',
      description:
        'Automatisch per Live-Abgleich aus dem IPTV-org DACH-Verzeichnis (DE/AT/CH) befüllt und aktualisiert.',
      channelIds: [],
      protocolOverride: 'channel',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
  ];

  const ipProfiles: IpProfile[] = [
    {
      id: 'prof-fritzbox',
      name: 'Heimnetz Fritz!Box (HTTP Proxy)',
      description:
        'Standard-Subnetz 192.168.178.x mit eindeutigen Ports je Kanal.',
      baseIp: '192.168.178.50',
      startPort: 8001,
      protocol: 'http',
      mode: 'increment-port',
      pathPrefix: '/live',
    },
    {
      id: 'prof-vlan-provider',
      name: 'Anbieter-Blöcke (VLAN Media)',
      description:
        'Vergibt eigene IP-Bereiche je Anbieter (Sky .10, Netflix .30, Amazon .50, Disney+ .70).',
      baseIp: '10.20.30.10',
      startPort: 8080,
      protocol: 'http',
      mode: 'provider-blocks',
      pathPrefix: '/stream',
    },
    {
      id: 'prof-multicast',
      name: 'Multicast IPTV (UDP)',
      description:
        'Lokales Multicast-Schema im Bereich 239.0.1.x auf Port 5000.',
      baseIp: '239.0.1.1',
      startPort: 5000,
      protocol: 'udp',
      mode: 'increment-ip',
      pathPrefix: '',
    },
  ];

  const streamSources: StreamSource[] = [
    {
      id: 'src-de-basis-feed',
      name: 'DE Live-TV Online-Feed (ARD/ZDF/Private)',
      url: '/api/feeds/de-live-quellen.m3u',
      targetPlaylistId: 'pl-auto-quellen',
      targetPlaylistName: 'Auto-Quellen Liste (DE)',
      autoRefresh: true,
      intervalMinutes: 5,
      enabled: true,
      defaultIp: '192.168.178.150',
      startPort: 8700,
      lastStatus: 'idle',
      updatedAt: BASE_TIME,
    },
    {
      id: 'src-de-fast-live',
      name: 'DE Sport, Doku & Film Online-Feed',
      url: '/api/feeds/de-fast-live.m3u',
      targetPlaylistId: 'pl-online-live-de',
      targetPlaylistName: 'Live-TV & Free-Streams Online (DE)',
      autoRefresh: true,
      intervalMinutes: 10,
      enabled: true,
      defaultIp: '192.168.178.165',
      startPort: 8800,
      lastStatus: 'idle',
      updatedAt: BASE_TIME,
    },
    {
      id: 'src-iptv-org-dach',
      name: 'IPTV-org DACH Live-Import (DE/AT/CH)',
      url: '/api/feeds/iptv-org-dach.m3u',
      targetPlaylistId: 'pl-iptv-org-dach',
      targetPlaylistName: 'IPTV-org DACH (Live-Import)',
      autoRefresh: true,
      intervalMinutes: 30,
      enabled: true,
      defaultIp: '192.168.178.175',
      startPort: 8900,
      lastStatus: 'idle',
      updatedAt: BASE_TIME,
    },
  ];

  return {
    channels,
    playlists,
    ipProfiles,
    streamSources,
  };
}

/**
 * Safely enriches an existing persisted store with newly verified online
 * upstreamUrls, additional catalog channels, playlists, and active feeds
 * without discarding user customizations.
 */
export function upgradeStoreWithOnlineCatalog(existing: CentralStore): {
  store: CentralStore;
  changed: boolean;
  backfilledUpstreamCount: number;
  addedChannelsCount: number;
  addedPlaylistsCount: number;
  addedSourcesCount: number;
} {
  const catalog = createInitialStore();
  let changed = false;
  let backfilledUpstreamCount = 0;
  let addedChannelsCount = 0;
  let addedPlaylistsCount = 0;
  let addedSourcesCount = 0;

  const catalogById = new Map(catalog.channels.map((c) => [c.id, c]));
  const catalogByName = new Map(
    catalog.channels.map((c) => [c.name.trim().toLowerCase(), c])
  );
  const LEGACY_AT_IDS = new Set(['orf1-hd', 'orf3-hd', 'orfsport-hd']);
  const nextChannels = existing.channels.map((ch) => {
    const template =
      catalogById.get(ch.id) || catalogByName.get(ch.name.trim().toLowerCase());
    const needsUpstream = Boolean(template?.upstreamUrl && !ch.upstreamUrl);
    const needsAtChMigration =
      LEGACY_AT_IDS.has(ch.id) && ch.provider === 'public_de';
    if (needsUpstream || needsAtChMigration) {
      changed = true;
      if (needsUpstream) backfilledUpstreamCount += 1;
      return {
        ...ch,
        ...(needsUpstream ? { upstreamUrl: template!.upstreamUrl } : {}),
        ...(needsAtChMigration ? { provider: 'at_ch' as const } : {}),
        updatedAt: BASE_TIME,
      };
    }
    return ch;
  });

  const existingIds = new Set(nextChannels.map((c) => c.id));
  const existingNames = new Set(
    nextChannels.map((c) => c.name.trim().toLowerCase())
  );
  const usedEndpoints = new Set(
    nextChannels.map((c) => `${c.protocol}://${c.ip}:${c.port}${c.path}`)
  );

  for (const template of catalog.channels) {
    const normName = template.name.trim().toLowerCase();
    if (existingIds.has(template.id) || existingNames.has(normName)) continue;
    const epKey = `${template.protocol}://${template.ip}:${template.port}${template.path}`;
    let port = template.port;
    while (
      usedEndpoints.has(`${template.protocol}://${template.ip}:${port}${template.path}`) &&
      port < 65535
    ) {
      port += 1;
    }
    const finalCh =
      port === template.port && !usedEndpoints.has(epKey)
        ? template
        : { ...template, port };
    usedEndpoints.add(`${finalCh.protocol}://${finalCh.ip}:${finalCh.port}${finalCh.path}`);
    nextChannels.push(finalCh);
    existingIds.add(finalCh.id);
    existingNames.add(normName);
    addedChannelsCount += 1;
    changed = true;
  }

  const MERGE_PLAYLIST_IDS = new Set([
    'pl-komplett-de',
    'pl-online-live-de',
    'pl-streaming-hubs',
    'pl-dach-at-ch',
    'pl-sport-musik-doku',
  ]);
  const nextPlaylists = existing.playlists.map((pl) => {
    if (MERGE_PLAYLIST_IDS.has(pl.id)) {
      const templatePl = catalog.playlists.find((p) => p.id === pl.id);
      if (templatePl) {
        const mergedIds = Array.from(
          new Set([...pl.channelIds, ...templatePl.channelIds])
        ).slice(0, 200);
        if (mergedIds.length !== pl.channelIds.length) {
          changed = true;
          return { ...pl, channelIds: mergedIds };
        }
      }
    }
    return pl;
  });

  const existingPlaylistIds = new Set(nextPlaylists.map((p) => p.id));
  for (const pl of catalog.playlists) {
    if (!existingPlaylistIds.has(pl.id)) {
      nextPlaylists.push(pl);
      existingPlaylistIds.add(pl.id);
      addedPlaylistsCount += 1;
      changed = true;
    }
  }

  const existingSources = existing.streamSources ?? [];
  const existingSourceIds = new Set(existingSources.map((s) => s.id));
  const nextSources = existingSources.map((src) => {
    if (
      src.id === 'src-de-basis-feed' &&
      (src.name !== 'DE Live-TV Online-Feed (ARD/ZDF/Private)' ||
        (typeof src.lastTotalCount === 'number' && src.lastTotalCount < 50))
    ) {
      changed = true;
      return {
        ...src,
        name: 'DE Live-TV Online-Feed (ARD/ZDF/Private)',
        lastSyncedAt: undefined,
        lastStatus: 'idle' as const,
      };
    }
    if (
      src.id === 'src-de-fast-live' &&
      typeof src.lastTotalCount === 'number' &&
      src.lastTotalCount < 35
    ) {
      changed = true;
      return {
        ...src,
        lastSyncedAt: undefined,
        lastStatus: 'idle' as const,
      };
    }
    return src;
  });
  for (const src of catalog.streamSources ?? []) {
    if (!existingSourceIds.has(src.id)) {
      nextSources.push(src);
      existingSourceIds.add(src.id);
      addedSourcesCount += 1;
      changed = true;
    }
  }

  return {
    store: {
      channels: nextChannels,
      playlists: nextPlaylists,
      ipProfiles:
        existing.ipProfiles.length > 0 ? existing.ipProfiles : catalog.ipProfiles,
      streamSources: nextSources,
    },
    changed,
    backfilledUpstreamCount,
    addedChannelsCount,
    addedPlaylistsCount,
    addedSourcesCount,
  };
}
