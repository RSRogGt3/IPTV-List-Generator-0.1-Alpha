import {
  Channel,
  ConflictItem,
  IpGenerationConfig,
  PROVIDER_META,
  ProviderId,
  StreamProtocol,
} from './types';

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIPv4(ip: string): boolean {
  const trimmed = ip.trim();
  const match = IPV4_REGEX.exec(trimmed);
  if (!match) return false;
  for (let i = 1; i <= 4; i++) {
    const part = match[i];
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
  }
  return true;
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function ipToInt(ip: string): number {
  if (!isValidIPv4(ip)) {
    throw new Error(`Ungültige IPv4-Adresse: ${ip}`);
  }
  const octets = ip.trim().split('.').map(Number);
  return (
    ((octets[0] << 24) >>> 0) +
    ((octets[1] << 16) >>> 0) +
    ((octets[2] << 8) >>> 0) +
    (octets[3] >>> 0)
  );
}

export function intToIp(num: number): string {
  const safe = num >>> 0;
  return [
    (safe >>> 24) & 255,
    (safe >>> 16) & 255,
    (safe >>> 8) & 255,
    safe & 255,
  ].join('.');
}

export function slugifyChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kanal';
}

export function normalizePath(path: string, protocol: StreamProtocol): string {
  if (protocol === 'udp' || protocol === 'rtp') {
    return '';
  }
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isPrivateIPv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false;
  const [a, b] = ip.trim().split('.').map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224 && a <= 239) return true; // Multicast
  return false;
}

export function isValidUpstreamUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function buildStreamUrl(
  channel: Pick<Channel, 'protocol' | 'ip' | 'port' | 'path'> & {
    id?: string;
    upstreamUrl?: string;
  },
  protocolOverride?: StreamProtocol | 'channel',
  options?: { mode?: 'auto' | 'local' | 'upstream' | 'proxy'; origin?: string }
): string {
  const mode = options?.mode ?? 'local';
  const hasUpstream =
    typeof channel.upstreamUrl === 'string' &&
    isValidUpstreamUrl(channel.upstreamUrl);

  if (mode === 'proxy' && hasUpstream && channel.id && options?.origin) {
    const cleanOrigin = options.origin.replace(/\/+$/, '');
    return `${cleanOrigin}/api/channels/${encodeURIComponent(channel.id)}/stream`;
  }

  if ((mode === 'upstream' || mode === 'auto') && hasUpstream) {
    return channel.upstreamUrl!.trim();
  }

  const proto =
    protocolOverride && protocolOverride !== 'channel'
      ? protocolOverride
      : channel.protocol;
  const cleanIp = channel.ip.trim();
  const portPart = isValidPort(channel.port) ? `:${channel.port}` : '';
  const pathPart = normalizePath(channel.path, proto);
  if (proto === 'udp' || proto === 'rtp') {
    return `${proto}://@${cleanIp}${portPart}`;
  }
  return `${proto}://${cleanIp}${portPart}${pathPart}`;
}

export function generateIpAssignments(
  targetChannels: Channel[],
  config: IpGenerationConfig
): Channel[] {
  if (!isValidIPv4(config.baseIp)) {
    throw new Error('Basis-IP ist keine gültige IPv4-Adresse.');
  }
  if (!isValidPort(config.startPort)) {
    throw new Error('Start-Port muss zwischen 1 und 65535 liegen.');
  }

  const baseInt = ipToInt(config.baseIp);
  const now = new Date().toISOString();
  const providerCounters = new Map<ProviderId, number>();

  return targetChannels.map((ch, idx) => {
    let nextIp = config.baseIp.trim();
    let nextPort = config.startPort;

    if (config.mode === 'increment-port') {
      const candidatePort = config.startPort + idx;
      if (!isValidPort(candidatePort)) {
        throw new Error(`Port-Überlauf bei Kanal "${ch.name}" (> 65535).`);
      }
      nextPort = candidatePort;
    } else if (config.mode === 'increment-ip') {
      nextIp = intToIp(baseInt + idx);
      nextPort = config.startPort;
    } else if (config.mode === 'provider-blocks') {
      // Deterministic subnet block per provider using /24 base prefix
      const octets = config.baseIp.trim().split('.').map(Number);
      const countInProvider = providerCounters.get(ch.provider) ?? 0;
      providerCounters.set(ch.provider, countInProvider + 1);
      const blockStart = PROVIDER_META[ch.provider]?.defaultBlockOffset ?? 180;
      const lastOctet = blockStart + countInProvider;
      if (lastOctet <= 254) {
        nextIp = `${octets[0]}.${octets[1]}.${octets[2]}.${lastOctet}`;
        nextPort = config.startPort;
      } else {
        nextIp = `${octets[0]}.${octets[1]}.${octets[2]}.${254}`;
        nextPort = Math.min(65535, config.startPort + (lastOctet - 254));
      }
    }

    let nextPath = '';
    if (config.protocol !== 'udp' && config.protocol !== 'rtp') {
      const prefix = config.pathPrefix.trim().replace(/\/+$/, '');
      const normalizedPrefix = prefix
        ? prefix.startsWith('/')
          ? prefix
          : `/${prefix}`
        : '';
      const slug = config.includeChannelSlugInPath
        ? `/${slugifyChannelName(ch.name)}`
        : '';
      nextPath = `${normalizedPrefix}${slug}`;
    }

    return {
      ...ch,
      protocol: config.protocol,
      ip: nextIp,
      port: nextPort,
      path: nextPath,
      updatedAt: now,
    };
  });
}

export function detectEndpointConflicts(channels: Channel[]): ConflictItem[] {
  const groups = new Map<string, Channel[]>();

  for (const ch of channels) {
    if (!ch.enabled) continue;
    const normPath = normalizePath(ch.path, ch.protocol);
    // For UDP/RTP or identical HTTP IP:Port without differentiating path, IP:Port+Path collides
    const key = `${ch.protocol}://${ch.ip.trim()}:${ch.port}${normPath}`;
    const existing = groups.get(key) ?? [];
    existing.push(ch);
    groups.set(key, existing);
  }

  const conflicts: ConflictItem[] = [];
  for (const [endpointKey, list] of groups.entries()) {
    if (list.length > 1) {
      conflicts.push({
        endpointKey,
        protocol: list[0].protocol,
        ip: list[0].ip,
        port: list[0].port,
        path: normalizePath(list[0].path, list[0].protocol),
        channels: list.map((c) => ({
          id: c.id,
          name: c.name,
          provider: c.provider,
        })),
      });
    }
  }

  return conflicts;
}
