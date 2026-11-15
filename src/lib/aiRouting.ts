export type ChatTaskMode = 'auto' | 'fast' | 'search' | 'interactive' | 'reasoning';

export type GeminiModelId =
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-hydrogen'
  | 'gemini-4-argon'
  | 'gemini-4-carbon';

export interface ResolvedModelRoute {
  model: GeminiModelId;
  resolvedMode: Exclude<ChatTaskMode, 'auto'>;
  useSearch: boolean;
  label: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SuggestedPlaylist {
  name: string;
  description: string;
  channelIds: string[];
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model: string;
  taskMode: ChatTaskMode;
  sources?: GroundingSource[];
  suggestedPlaylist?: SuggestedPlaylist;
  createdAt: string;
}

const SEARCH_KEYWORDS = [
  'heute',
  'aktuell',
  'jetzt',
  'wann läuft',
  'tv-programm',
  'tv programm',
  'programm',
  'bundesliga',
  'champions league',
  'formel 1',
  'neuheiten',
  'neu auf',
  'erscheint',
  'startet',
  'suche',
  'google',
  'frequenz',
  '2026',
  'live',
];

const REASONING_KEYWORDS = [
  'architektur',
  'subnetz',
  'vlan',
  'konflikt',
  'analyse',
  'analysiere',
  'warum',
  'routing',
  'multicast',
  'igmp',
  'latenz',
  'tiefenanalyse',
  'optimier',
  'sicherheit',
  'netzwerkplan',
  'fehlerursache',
];

const INTERACTIVE_KEYWORDS = [
  'playlist',
  'erstelle',
  'zusammenstellen',
  'paket',
  'kombiniere',
  'empfiehl',
  'kuratier',
  'm3u',
  'sortier',
  'verknüpf',
];

export function resolveGeminiModel(
  mode: ChatTaskMode,
  prompt: string,
  forceSearch?: boolean
): ResolvedModelRoute {
  if (mode === 'fast') {
    return {
      model: 'gemini-3.1-flash-lite',
      resolvedMode: 'fast',
      useSearch: Boolean(forceSearch),
      label: 'Schnellmodus (gemini-3.1-flash-lite)',
    };
  }
  if (mode === 'search') {
    return {
      model: 'gemini-4-hydrogen',
      resolvedMode: 'search',
      useSearch: true,
      label: 'Live-Suche (gemini-4-hydrogen + Google Search)',
    };
  }
  if (mode === 'interactive') {
    return {
      model: 'gemini-4-argon',
      resolvedMode: 'interactive',
      useSearch: Boolean(forceSearch),
      label: 'Interaktive Planung (gemini-4-argon)',
    };
  }
  if (mode === 'reasoning') {
    return {
      model: 'gemini-4-carbon',
      resolvedMode: 'reasoning',
      useSearch: Boolean(forceSearch),
      label: 'Tiefenanalyse (gemini-4-carbon)',
    };
  }

  // Auto-routing based on prompt intent
  const lower = prompt.trim().toLowerCase();

  if (forceSearch || SEARCH_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      model: 'gemini-4-hydrogen',
      resolvedMode: 'search',
      useSearch: true,
      label: 'Auto -> Live-Suche (gemini-4-hydrogen + Google Search)',
    };
  }

  if (REASONING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      model: 'gemini-4-carbon',
      resolvedMode: 'reasoning',
      useSearch: false,
      label: 'Auto -> Tiefenanalyse (gemini-4-carbon)',
    };
  }

  if (INTERACTIVE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      model: 'gemini-4-argon',
      resolvedMode: 'interactive',
      useSearch: false,
      label: 'Auto -> Interaktive Planung (gemini-4-argon)',
    };
  }

  if (lower.length > 0 && lower.length < 48) {
    return {
      model: 'gemini-3.1-flash-lite',
      resolvedMode: 'fast',
      useSearch: false,
      label: 'Auto -> Schnellmodus (gemini-3.1-flash-lite)',
    };
  }

  return {
    model: 'gemini-4-hydrogen',
    resolvedMode: 'search',
    useSearch: false,
    label: 'Auto -> Standard (gemini-4-hydrogen)',
  };
}

export function extractSuggestedPlaylist(
  text: string,
  validChannelIds: Set<string>
): { cleanText: string; suggestedPlaylist?: SuggestedPlaylist } {
  const regex = /```playlist_json\s*([\s\S]*?)```/i;
  const match = regex.exec(text);
  if (!match) {
    return { cleanText: text };
  }

  const cleanText = text.replace(regex, '').trim();
  try {
    const parsed = JSON.parse(match[1].trim()) as Partial<SuggestedPlaylist>;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.channelIds)) {
      return { cleanText: cleanText || text };
    }
    const filteredIds = Array.from(
      new Set(
        parsed.channelIds.filter(
          (id): id is string => typeof id === 'string' && validChannelIds.has(id)
        )
      )
    ).slice(0, 50);

    if (filteredIds.length === 0 || !parsed.name.trim()) {
      return { cleanText: cleanText || text };
    }

    return {
      cleanText: cleanText || `Vorschlag für Playlist "${parsed.name.trim()}" erstellt.`,
      suggestedPlaylist: {
        name: parsed.name.trim().slice(0, 120),
        description:
          typeof parsed.description === 'string'
            ? parsed.description.trim().slice(0, 400)
            : 'KI-kuratierte Playlist',
        channelIds: filteredIds,
      },
    };
  } catch {
    return { cleanText: cleanText || text };
  }
}
