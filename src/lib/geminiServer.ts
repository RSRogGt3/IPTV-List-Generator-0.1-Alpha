import { GoogleGenAI, Type } from '@google/genai';
import {
  ChatTaskMode,
  GroundingSource,
  SuggestedPlaylist,
  extractSuggestedPlaylist,
  resolveGeminiModel,
} from './aiRouting';
import { buildStreamUrl } from './ipUtils';
import { Channel, ConflictItem, PROVIDER_META, Playlist } from './types';

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Kein GEMINI_API_KEY konfiguriert. Bitte hinterlege deinen Schlüssel in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatWorkspaceContext(
  channels: Channel[],
  playlists: Playlist[],
  conflicts: ConflictItem[]
): string {
  const channelSummary = channels
    .slice(0, 80)
    .map(
      (c) =>
        `- ID:${c.id} | ${c.name} (${PROVIDER_META[c.provider]?.shortLabel ?? c.provider}, ${c.category}, ${c.quality}) -> ${buildStreamUrl(c)} [${c.enabled ? 'Aktiv' : 'Pausiert'}]`
    )
    .join('\n');

  const playlistSummary = playlists
    .map(
      (p) =>
        `- ID:${p.id} | "${p.name}" (${p.channelIds.length} Kanäle): ${p.channelIds.slice(0, 15).join(', ')}`
    )
    .join('\n');

  const conflictSummary =
    conflicts.length === 0
      ? 'Keine IP/Port-Konflikte aktiv.'
      : conflicts
          .map(
            (cf) =>
              `- Konflikt ${cf.endpointKey}: belegt durch ${cf.channels.map((x) => x.name).join(', ')}`
          )
          .join('\n');

  return `AKTUELLER STREAMGRID DE BESTAND:
Kanäle (${channels.length}):
${channelSummary}

Playlists (${playlists.length}):
${playlistSummary || '- Noch keine Playlists'}

Netzwerk-Konflikte:
${conflictSummary}`;
}

function extractGroundingSources(response: {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
    };
  }>;
}): GroundingSource[] {
  const chunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const ch of chunks) {
    const uri = ch.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({
      uri,
      title: ch.web?.title?.trim() || uri,
    });
  }
  return sources.slice(0, 10);
}

export function formatGeminiApiError(err: unknown): {
  status: number;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY')) {
    return { status: 400, message: raw };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Gemini API-Schlüssel ungültig oder nicht berechtigt. Bitte prüfe deinen Key unter Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Kontingent erreicht (429). Für Gemini 4 Modelle (gemini-4-hydrogen, gemini-4-argon, gemini-4-carbon) ist ein aktiver API-Key mit Kontingent unter Settings > Secrets erforderlich.',
    };
  }
  if (raw.includes('UNAVAILABLE') || raw.includes('503')) {
    return {
      status: 503,
      message:
        'Das gewählte Gemini-Modell ist momentan stark ausgelastet (503). Bitte versuche es in wenigen Sekunden erneut.',
    };
  }
  return {
    status: 500,
    message: `KI-Anfrage fehlgeschlagen: ${raw}`,
  };
}

export async function runAiChatTurn(params: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  taskMode: ChatTaskMode;
  forceSearch?: boolean;
  channels: Channel[];
  playlists: Playlist[];
  conflicts: ConflictItem[];
}): Promise<{
  text: string;
  model: string;
  resolvedMode: Exclude<ChatTaskMode, 'auto'>;
  useSearch: boolean;
  sources: GroundingSource[];
  suggestedPlaylist?: SuggestedPlaylist;
}> {
  const ai = createGeminiClient();
  const route = resolveGeminiModel(params.taskMode, params.message, params.forceSearch);
  const contextBlock = formatWorkspaceContext(
    params.channels,
    params.playlists,
    params.conflicts
  );

  const systemInstruction = `Du bist der zentrale KI-Medien- und Netzwerk-Architekt von "StreamGrid DE".
Du hilfst deutschsprachigen Nutzern beim Verwalten von IP-Endpunkten, Ports, Protokollen (HTTP/HTTPS/RTSP/UDP/RTP) und M3U-Playlists für Sky Deutschland, Netflix DE, Amazon Prime Video, Disney+ und alle deutschen TV-Kanäle.

Regeln:
- Antworte immer präzise, praxisnah und auf Deutsch.
- Nutze den aktuellen Bestand des Nutzers (siehe unten), wenn Fragen zu seinen Kanälen, IPs, Konflikten oder Playlists gestellt werden.
- Wenn du eine neue Playlist zusammenstellst oder vorschlägst, gib am Ende deiner Antwort genau einen Block im Format \`\`\`playlist_json
{ "name": "Kurzer Titel", "description": "Kurze Beschreibung", "channelIds": ["id-1", "id-2"] }
\`\`\` aus und verwende ausschließlich existierende Kanal-IDs aus dem Bestand.
- Wenn Google Search Grounding aktiv ist, liefere aktuelle, faktenbasierte Informationen (z. B. heutige Übertragungen, neue Serien/Filme, aktuelle Senderinfos).

${contextBlock}`;

  const formattedHistory = params.history.slice(-16).map((h) => ({
    role: h.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: h.text }],
  }));

  const chat = ai.chats.create({
    model: route.model,
    history: formattedHistory,
    config: {
      systemInstruction,
      ...(route.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });

  const response = await chat.sendMessage({
    message: params.message,
  });

  const rawText = (response.text ?? '').trim() || 'Keine Antwort erhalten.';
  const validIds = new Set(params.channels.map((c) => c.id));
  const { cleanText, suggestedPlaylist } = extractSuggestedPlaylist(
    rawText,
    validIds
  );
  const sources = route.useSearch ? extractGroundingSources(response) : [];

  return {
    text: cleanText,
    model: route.model,
    resolvedMode: route.resolvedMode,
    useSearch: route.useSearch,
    sources,
    suggestedPlaylist,
  };
}

export async function runLiveSearchGrounding(params: {
  query: string;
  providerFocus?: string;
}): Promise<{
  answer: string;
  model: string;
  sources: GroundingSource[];
}> {
  const ai = createGeminiClient();
  const focusHint = params.providerFocus
    ? `Schwerpunkt Anbieter/Plattform: ${params.providerFocus}. `
    : '';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `${focusHint}Recherchiere aktuell für Deutschland (Sky, Netflix, Amazon Prime Video, Disney+, ARD, ZDF, RTL, ProSiebenSat.1, Sport-TV): ${params.query}`,
    config: {
      systemInstruction:
        'Du bist ein aktueller deutscher TV- und Streaming-Recherche-Assistent. Fasse aktuelle Programmhinweise, Übertragungsrechte, Sendernews oder Streaming-Starts kompakt, strukturiert und auf Deutsch zusammen.',
      tools: [{ googleSearch: {} }],
    },
  });

  return {
    answer: (response.text ?? '').trim() || 'Keine Suchergebnisse gefunden.',
    model: 'gemini-4-hydrogen',
    sources: extractGroundingSources(response),
  };
}

export async function runPlaylistRecommendation(params: {
  goal: string;
  channels: Channel[];
}): Promise<SuggestedPlaylist & { model: string; rationale: string }> {
  const ai = createGeminiClient();
  const validIds = new Set(params.channels.map((c) => c.id));
  const catalogText = params.channels
    .map(
      (c) =>
        `${c.id}: ${c.name} (${PROVIDER_META[c.provider]?.shortLabel ?? c.provider}, ${c.category}, ${c.quality})`
    )
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-argon',
    contents: `Nutzerwunsch: "${params.goal}"\n\nVerfügbarer Kanalkatalog:\n${catalogText}`,
    config: {
      systemInstruction:
        'Du bist ein interaktiver Playlist-Kurator für StreamGrid DE. Wähle die am besten passenden Kanal-IDs aus dem bereitgestellten Kanalkatalog in sinnvoller Reihenfolge aus.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Prägnanter deutscher Playlist-Name.',
          },
          description: {
            type: Type.STRING,
            description: 'Kurze Beschreibung der Playlist.',
          },
          rationale: {
            type: Type.STRING,
            description: 'Kurze Begründung der Senderauswahl auf Deutsch.',
          },
          channelIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Geordnete Liste gültiger Kanal-IDs aus dem Katalog.',
          },
        },
        required: ['name', 'description', 'rationale', 'channelIds'],
      },
    },
  });

  const jsonStr = (response.text ?? '{}').trim();
  const parsed = JSON.parse(jsonStr) as {
    name?: string;
    description?: string;
    rationale?: string;
    channelIds?: string[];
  };

  const filteredIds = Array.from(
    new Set((parsed.channelIds ?? []).filter((id) => validIds.has(id)))
  ).slice(0, 50);

  if (filteredIds.length === 0) {
    throw new Error(
      'Die KI konnte keine passenden Kanäle aus dem aktuellen Bestand zuordnen. Formuliere den Wunsch etwas genauer.'
    );
  }

  return {
    name: (parsed.name || 'KI-Empfehlung DE').slice(0, 120),
    description: (parsed.description || params.goal).slice(0, 400),
    rationale: parsed.rationale || 'Passende deutsche Kanäle automatisch zusammengestellt.',
    channelIds: filteredIds,
    model: 'gemini-4-argon',
  };
}
