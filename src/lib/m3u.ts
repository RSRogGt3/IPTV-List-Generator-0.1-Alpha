import {
  buildStreamUrl,
  isValidIPv4,
  isValidPort,
  isValidUpstreamUrl,
  slugifyChannelName,
} from './ipUtils';
import {
  Channel,
  M3UExportMode,
  Playlist,
  ProviderId,
  StreamProtocol,
} from './types';

function inferProviderFromGroupAndName(group: string, name: string): ProviderId {
  const haystack = `${group} ${name}`.toLowerCase();
  if (haystack.includes('sky')) return 'sky';
  if (haystack.includes('netflix')) return 'netflix';
  if (haystack.includes('amazon') || haystack.includes('prime') || haystack.includes('freevee')) {
    return 'amazon';
  }
  if (haystack.includes('disney') || haystack.includes('pixar') || haystack.includes('national geographic')) {
    return 'disney';
  }
  if (
    haystack.includes('orf') ||
    haystack.includes('servustv') ||
    haystack.includes('servus tv') ||
    haystack.includes('puls 4') ||
    haystack.includes('puls 24') ||
    haystack.includes('oe24') ||
    haystack.includes('srf') ||
    haystack.includes('telezüri') ||
    haystack.includes('telezuri') ||
    haystack.includes('telebasel') ||
    haystack.includes('telebern') ||
    haystack.includes('teleticino') ||
    haystack.includes('telenova') ||
    haystack.includes('carac') ||
    haystack.includes('canal alpha') ||
    haystack.includes('kronehit') ||
    haystack.includes('okto') ||
    haystack.includes('w24') ||
    haystack.includes('schladming') ||
    haystack.includes('steiermark') ||
    haystack.includes('oberösterreich') ||
    haystack.includes('oberosterreich') ||
    haystack.includes('antenne kaernten') ||
    haystack.includes('antenne kärnten') ||
    haystack.includes('radio 3i') ||
    haystack.includes('österreich') ||
    haystack.includes('schweiz') ||
    haystack.includes('(at)') ||
    haystack.includes('(ch)') ||
    haystack.includes('at & ch')
  ) {
    return 'at_ch';
  }
  if (
    haystack.includes('ard') ||
    haystack.includes('das erste') ||
    haystack.includes('zdf') ||
    haystack.includes('arte') ||
    haystack.includes('3sat') ||
    haystack.includes('phoenix') ||
    haystack.includes('kika') ||
    haystack.includes('wdr') ||
    haystack.includes('ndr') ||
    haystack.includes('swr') ||
    haystack.includes('mdr') ||
    haystack.includes('rbb') ||
    haystack.includes('br fernsehen') ||
    haystack.includes('sr fernsehen') ||
    haystack.includes('radio bremen') ||
    haystack.includes('dw deutsch') ||
    haystack.includes('deutsche welle') ||
    haystack.includes('tagesschau') ||
    haystack.includes('alex berlin') ||
    haystack.includes('öffentlich-rechtlich')
  ) {
    return 'public_de';
  }
  if (
    haystack.includes('rtl') ||
    haystack.includes('prosieben') ||
    haystack.includes('pro7') ||
    haystack.includes('sat.1') ||
    haystack.includes('sat1') ||
    haystack.includes('vox') ||
    haystack.includes('kabel') ||
    haystack.includes('sixx') ||
    haystack.includes('tele 5') ||
    haystack.includes('tele5') ||
    haystack.includes('nitro') ||
    haystack.includes('dokusat') ||
    haystack.includes('comedy central') ||
    haystack.includes('mtv') ||
    haystack.includes('nickelodeon') ||
    haystack.includes('sport1') ||
    haystack.includes('eurosport') ||
    haystack.includes('dmax') ||
    haystack.includes('welt') ||
    haystack.includes('n-tv') ||
    haystack.includes('n24') ||
    haystack.includes('deluxe') ||
    haystack.includes('xite') ||
    haystack.includes('zee one') ||
    haystack.includes('more than sports') ||
    haystack.includes('private de')
  ) {
    return 'private_de';
  }
  return 'custom';
}

export function generateM3U(
  playlist: Playlist,
  allChannels: Channel[],
  options?: { mode?: M3UExportMode; origin?: string; playableOnly?: boolean }
): string {
  const channelMap = new Map(allChannels.map((c) => [c.id, c]));
  const lines: string[] = [
    `#EXTM3U x-playlist-name="${playlist.name.replace(/"/g, "'")}"`,
  ];
  const mode: M3UExportMode = options?.mode ?? 'auto';
  const playableOnly = Boolean(options?.playableOnly);

  for (const channelId of playlist.channelIds) {
    const ch = channelMap.get(channelId);
    if (!ch || !ch.enabled) continue;
    if (playableOnly && (!ch.upstreamUrl || !isValidUpstreamUrl(ch.upstreamUrl))) {
      continue;
    }

    const tvgId = (ch.tvgId || slugifyChannelName(ch.name)).replace(/"/g, "'");
    const tvgName = ch.name.replace(/"/g, "'");
    const groupTitle = ch.category.replace(/"/g, "'");
    const url = buildStreamUrl(ch, playlist.protocolOverride, {
      mode,
      origin: options?.origin,
    });

    lines.push(
      `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-language="${ch.language}" group-title="${groupTitle}",${ch.name}`
    );
    lines.push(url);
  }

  return lines.join('\n') + '\n';
}

export interface ParsedM3UEntry {
  name: string;
  provider: ProviderId;
  category: string;
  language: string;
  quality: Channel['quality'];
  protocol: StreamProtocol;
  ip: string;
  port: number;
  path: string;
  tvgId: string;
  enabled: boolean;
  upstreamUrl?: string;
}

export function parseM3U(
  rawM3U: string,
  defaults: { defaultIp?: string; startPort?: number } = {}
): ParsedM3UEntry[] {
  const fallbackIp =
    defaults.defaultIp && isValidIPv4(defaults.defaultIp)
      ? defaults.defaultIp
      : '192.168.178.100';
  let nextPort =
    defaults.startPort && isValidPort(defaults.startPort) ? defaults.startPort : 8080;

  const lines = rawM3U
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedM3UEntry[] = [];
  let pendingMeta: {
    name: string;
    group: string;
    tvgId: string;
    language: string;
  } | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      const attrPart = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const titlePart = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Unbenannter Kanal';

      const groupMatch = /group-title="([^"]*)"/i.exec(attrPart);
      const tvgIdMatch = /tvg-id="([^"]*)"/i.exec(attrPart);
      const langMatch = /tvg-language="([^"]*)"/i.exec(attrPart);

      pendingMeta = {
        name: titlePart || 'Unbenannter Kanal',
        group: groupMatch?.[1]?.trim() || 'Importiert',
        tvgId: tvgIdMatch?.[1]?.trim() || slugifyChannelName(titlePart || 'kanal'),
        language: langMatch?.[1]?.trim() || 'DE',
      };
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // URL line
    const meta = pendingMeta ?? {
      name: `Kanal ${results.length + 1}`,
      group: 'Importiert',
      tvgId: `kanal-${results.length + 1}`,
      language: 'DE',
    };
    pendingMeta = null;

    let protocol: StreamProtocol = 'http';
    let ip = fallbackIp;
    let port = nextPort;
    let path = `/live/${slugifyChannelName(meta.name)}`;
    let upstreamUrl: string | undefined;

    if (isValidUpstreamUrl(line)) {
      const parsed = new URL(line);
      if (!isValidIPv4(parsed.hostname)) {
        upstreamUrl = line;
      }
    }

    const protoMatch = /^(https?|rtsp|udp|rtp):\/\/@?([^/:]+)(?::(\d+))?(\/.*)?$/i.exec(line);
    if (protoMatch) {
      const rawProto = protoMatch[1].toLowerCase();
      if (
        rawProto === 'http' ||
        rawProto === 'https' ||
        rawProto === 'rtsp' ||
        rawProto === 'udp' ||
        rawProto === 'rtp'
      ) {
        protocol = rawProto;
      }
      const host = protoMatch[2];
      if (isValidIPv4(host)) {
        ip = host;
      }
      const parsedPort = protoMatch[3] ? Number(protoMatch[3]) : NaN;
      if (isValidPort(parsedPort)) {
        port = parsedPort;
      } else {
        port = nextPort++;
      }
      if (protoMatch[4]) {
        path = protoMatch[4];
      }
    } else {
      port = nextPort++;
    }

    const upperName = meta.name.toUpperCase();
    const quality: Channel['quality'] = upperName.includes('4K') || upperName.includes('UHD')
      ? '4K UHD'
      : upperName.includes('HD')
        ? 'Full HD'
        : 'HD';

    results.push({
      name: meta.name,
      provider: inferProviderFromGroupAndName(meta.group, meta.name),
      category: meta.group,
      language: meta.language,
      quality,
      protocol,
      ip,
      port,
      path,
      tvgId: meta.tvgId,
      enabled: true,
      ...(upstreamUrl ? { upstreamUrl } : {}),
    });
  }

  return results;
}
