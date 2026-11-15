import { FormEvent, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Globe,
  ListPlus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  ChatMessageItem,
  ChatTaskMode,
  GroundingSource,
  SuggestedPlaylist,
} from '../lib/aiRouting';
import { api } from '../lib/api';
import { Channel, Playlist } from '../lib/types';

function renderInlineFormatting(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="font-mono text-[12px] bg-slate-100 text-slate-800 px-1 py-0.5 rounded"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function FormattedAiText({
  text,
  inverse = false,
}: {
  text: string;
  inverse?: boolean;
}) {
  if (inverse) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }

  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" aria-hidden="true" />;
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h3
              key={idx}
              className="font-display text-sm font-semibold text-slate-900 pt-1.5"
            >
              {renderInlineFormatting(trimmed.slice(4))}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3
              key={idx}
              className="font-display text-sm font-semibold text-slate-900 pt-1.5"
            >
              {renderInlineFormatting(trimmed.slice(3))}
            </h3>
          );
        }
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="text-slate-400 select-none mt-0.5" aria-hidden="true">
                •
              </span>
              <span className="flex-1">{renderInlineFormatting(trimmed.slice(2))}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

interface AiAssistantViewProps {
  channels: Channel[];
  playlists: Playlist[];
  messages: ChatMessageItem[];
  onSendMessage: (payload: {
    message: string;
    taskMode: ChatTaskMode;
    forceSearch: boolean;
  }) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onCreatePlaylistFromSuggestion: (
    suggestion: SuggestedPlaylist
  ) => Promise<void>;
}

const MODE_OPTIONS: {
  id: ChatTaskMode;
  label: string;
  modelHint: string;
}[] = [
  { id: 'auto', label: 'Auto-Wahl', modelHint: 'Intelligentes Routing' },
  { id: 'fast', label: 'Schnell', modelHint: 'gemini-3.1-flash-lite' },
  { id: 'search', label: 'Websuche', modelHint: 'gemini-4-hydrogen + Google' },
  { id: 'interactive', label: 'Planer', modelHint: 'gemini-4-argon' },
  { id: 'reasoning', label: 'Tiefenanalyse', modelHint: 'gemini-4-carbon' },
];

const QUICK_PROMPTS: {
  label: string;
  prompt: string;
  mode: ChatTaskMode;
  search: boolean;
}[] = [
  {
    label: 'Live-Sport heute (Sky & Prime)',
    prompt: 'Welche Live-Sport-Highlights laufen heute in Deutschland auf Sky, Amazon Prime und im Free-TV?',
    mode: 'search',
    search: true,
  },
  {
    label: 'Wochenend-Playlist erstellen',
    prompt: 'Stelle mir eine vielseitige Wochenend-Playlist aus Sky, Netflix, Amazon Prime, Disney+ und ARD/ZDF zusammen.',
    mode: 'interactive',
    search: false,
  },
  {
    label: 'IP-Netzwerk & Konflikte prüfen',
    prompt: 'Analysiere meine aktuellen IP-Zuweisungen, Ports und Konflikte und gib mir eine saubere VLAN-/Subnetz-Empfehlung.',
    mode: 'reasoning',
    search: false,
  },
  {
    label: 'HTTP vs. UDP Multicast kurz',
    prompt: 'Erkläre kurz den Unterschied zwischen HTTP-Proxy und UDP-Multicast für lokale M3U-Playlists.',
    mode: 'fast',
    search: false,
  },
];

const SEARCH_TOPICS = [
  { label: 'Sky Bundesliga heute', query: 'Sky Sport Bundesliga Übertragungen heute Deutschland' },
  { label: 'Netflix DE Neuheiten', query: 'Netflix Deutschland Neuheiten Filme Serien diese Woche' },
  { label: 'Prime Video Sport', query: 'Amazon Prime Video Champions League Übertragung Deutschland aktuell' },
  { label: 'Disney+ Highlights DE', query: 'Disney+ Deutschland neue Filme und Serien aktuell' },
];

export function AiAssistantView({
  channels,
  playlists,
  messages,
  onSendMessage,
  onClearHistory,
  onCreatePlaylistFromSuggestion,
}: AiAssistantViewProps) {
  const [taskMode, setTaskMode] = useState<ChatTaskMode>('auto');
  const [forceSearch, setForceSearch] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Google Search Grounding panel state
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFocus, setProviderFocus] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<{
    answer: string;
    model: string;
    sources: GroundingSource[];
  } | null>(null);

  // KI Playlist Generator panel state
  const [playlistGoal, setPlaylistGoal] = useState('');
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<
    (SuggestedPlaylist & { model: string; rationale: string }) | null
  >(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const channelMap = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels]
  );

  const handleChatSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setChatError(null);
    setSending(true);
    setInput('');
    try {
      await onSendMessage({
        message: trimmed,
        taskMode,
        forceSearch: taskMode === 'search' ? true : forceSearch,
      });
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'Nachricht konnte nicht gesendet werden.'
      );
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleQuickPrompt = async (item: (typeof QUICK_PROMPTS)[number]) => {
    if (sending) return;
    setTaskMode(item.mode);
    setForceSearch(item.search);
    setChatError(null);
    setSending(true);
    try {
      await onSendMessage({
        message: item.prompt,
        taskMode: item.mode,
        forceSearch: item.search,
      });
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'Anfrage fehlgeschlagen.'
      );
    } finally {
      setSending(false);
    }
  };

  const executeLiveSearch = async (queryText: string) => {
    const q = queryText.trim();
    if (!q || searching) return;
    setSearchError(null);
    setSearching(true);
    try {
      const res = await api.aiSearch({
        query: q,
        providerFocus: providerFocus || undefined,
      });
      setSearchResult(res);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : 'Live-Suche fehlgeschlagen.'
      );
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await executeLiveSearch(searchQuery);
  };

  const handleRecommendSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const g = playlistGoal.trim();
    if (!g || recommending) return;
    setRecommendError(null);
    setRecommending(true);
    try {
      const res = await api.aiRecommendPlaylist({
        goal: g,
        channels,
      });
      setRecommendation(res);
    } catch (err) {
      setRecommendError(
        err instanceof Error ? err.message : 'Playlist-Generierung fehlgeschlagen.'
      );
    } finally {
      setRecommending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left 8 Columns: Multi-Turn Gemini Chatbot */}
      <section
        aria-label="Gemini Mehrrunden-Chatbot"
        className="xl:col-span-8 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="font-display text-base font-semibold text-slate-900">
                StreamGrid KI-Architekt & Medienassistent
              </h1>
              <p className="text-xs text-slate-500">
                Kennt deine {channels.length} Kanäle, IP-Adressen und {playlists.length} Playlists · Multi-Modell-Routing
              </p>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Verlauf löschen</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="radiogroup"
              aria-label="KI-Aufgabenmodus"
              className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md"
            >
              {MODE_OPTIONS.map((opt) => {
                const active = taskMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={opt.modelHint}
                    onClick={() => setTaskMode(opt.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={taskMode === 'search' ? true : forceSearch}
                disabled={taskMode === 'search'}
                onChange={(e) => setForceSearch(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Google Search Grounding aktivieren</span>
            </label>
          </div>
        </div>

        {/* Scrollable Message Thread */}
        <div
          aria-label="Chatverlauf"
          className="flex-1 min-h-[380px] max-h-[540px] overflow-y-auto p-5 space-y-4 bg-slate-50/50"
        >
          {messages.length === 0 ? (
            <div className="py-8 space-y-5">
              <div className="max-w-lg">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Wie kann ich bei deinen Sendern, IPs oder Playlists helfen?
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Wähle einen Schnellstart oder stelle eine eigene Frage. Je nach Aufgabe nutzt der Assistent{' '}
                  <span className="font-mono text-slate-700">gemini-3.1-flash-lite</span>,{' '}
                  <span className="font-mono text-slate-700">gemini-4-hydrogen</span> (mit Google Search),{' '}
                  <span className="font-mono text-slate-700">gemini-4-argon</span> oder{' '}
                  <span className="font-mono text-slate-700">gemini-4-carbon</span>.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {QUICK_PROMPTS.map((qp) => (
                  <button
                    key={qp.label}
                    type="button"
                    disabled={sending}
                    onClick={() => handleQuickPrompt(qp)}
                    className="text-left p-3.5 bg-white border border-slate-200 rounded-md hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      {qp.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 line-clamp-2">
                      {qp.prompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="mb-1 text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="font-medium text-slate-700">
                    {msg.role === 'user' ? 'Du' : 'StreamGrid KI'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{msg.model}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {new Date(msg.createdAt).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div
                  className={`max-w-full sm:max-w-[90%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  <FormattedAiText text={msg.text} inverse={msg.role === 'user'} />

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1">
                      <div className="text-[11px] font-semibold text-slate-500">
                        Google Search Quellen
                      </div>
                      <ul className="space-y-1">
                        {msg.sources.map((src) => (
                          <li key={src.uri}>
                            <a
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline break-all"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>{src.title}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {msg.suggestedPlaylist && (
                    <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900">
                          Playlist-Vorschlag: {msg.suggestedPlaylist.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {msg.suggestedPlaylist.channelIds.length} Kanäle ausgewählt
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onCreatePlaylistFromSuggestion(msg.suggestedPlaylist!)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
                      >
                        <ListPlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Playlist direkt anlegen</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-start">
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-500">
                KI analysiert Anfrage ({MODE_OPTIONS.find((m) => m.id === taskMode)?.modelHint})...
              </div>
            </div>
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleChatSubmit}
          className="p-4 border-t border-slate-200 bg-white space-y-2.5"
        >
          {chatError && (
            <div
              role="alert"
              className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {chatError}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <label htmlFor="ai-chat-input" className="sr-only">
                Nachricht an StreamGrid KI
              </label>
              <textarea
                id="ai-chat-input"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit(e);
                  }
                }}
                placeholder="Frage stellen, z. B. 'Erstelle mir eine Sport- & Film-Playlist' oder 'Welche Bundesliga-Spiele laufen heute?'"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap min-h-[44px]"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              <span>Senden</span>
            </button>
          </div>
        </form>
      </section>

      {/* Right 4 Columns: Google Search Grounding + Smart Playlist Generator */}
      <div className="xl:col-span-4 space-y-6">
        {/* Live Search Grounding Card */}
        <section
          aria-label="Live-Suche mit Google Search Grounding"
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
              <span>Live-Programm & Sender-Suche</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Aktuelle Sendezeiten, Übertragungsrechte und Neustarts via{' '}
              <span className="font-mono text-slate-700">gemini-4-hydrogen</span> + Google Search.
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="space-y-2.5">
            <div>
              <label htmlFor="live-search-input" className="sr-only">
                Live-Suchanfrage
              </label>
              <input
                id="live-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="z. B. Bundesliga Spiele heute auf Sky"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Anbieter-Schwerpunkt"
                value={providerFocus}
                onChange={(e) => setProviderFocus(e.target.value)}
                className="flex-1 px-2.5 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">Alle Anbieter</option>
                <option value="Sky Deutschland">Sky Deutschland</option>
                <option value="Netflix Deutschland">Netflix DE</option>
                <option value="Amazon Prime Video Deutschland">Amazon Prime</option>
                <option value="Disney+ Deutschland">Disney+</option>
                <option value="ARD / ZDF / Free-TV Deutschland">ARD / ZDF / Free-TV</option>
              </select>
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {searching ? 'Sucht...' : 'Live suchen'}
              </button>
            </div>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {SEARCH_TOPICS.map((topic) => (
              <button
                key={topic.label}
                type="button"
                disabled={searching}
                onClick={() => {
                  setSearchQuery(topic.query);
                  executeLiveSearch(topic.query);
                }}
                className="px-2.5 py-1 text-xs text-slate-700 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
              >
                {topic.label}
              </button>
            ))}
          </div>

          {searchError && (
            <div
              role="alert"
              className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {searchError}
            </div>
          )}

          {searchResult && (
            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <div className="text-xs text-slate-800 leading-relaxed max-h-60 overflow-y-auto">
                <FormattedAiText text={searchResult.answer} />
              </div>
              {searchResult.sources.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Quellen ({searchResult.sources.length})
                  </div>
                  <ul className="space-y-1">
                    {searchResult.sources.map((src) => (
                      <li key={src.uri}>
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline break-all"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>{src.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Smart AI Playlist Builder Card */}
        <section
          aria-label="KI-Playlist-Generator"
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              KI-Playlist-Generator
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Beschreibe deinen Wunsch —{' '}
              <span className="font-mono text-slate-700">gemini-4-argon</span> wählt passende Sender inkl. ihrer IP-Endpunkte aus.
            </p>
          </div>

          <form onSubmit={handleRecommendSubmit} className="space-y-2.5">
            <label htmlFor="ai-pl-goal" className="sr-only">
              Wunsch für KI-Playlist
            </label>
            <textarea
              id="ai-pl-goal"
              rows={2}
              value={playlistGoal}
              onChange={(e) => setPlaylistGoal(e.target.value)}
              placeholder="z. B. Familienabend mit Disney+, Netflix Kino, ZDF und KiKA"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={recommending || !playlistGoal.trim()}
              className="w-full py-2 px-3 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {recommending
                ? 'Stellt Kanäle zusammen...'
                : 'Playlist per KI generieren'}
            </button>
          </form>

          {recommendError && (
            <div
              role="alert"
              className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md"
            >
              {recommendError}
            </div>
          )}

          {recommendation && (
            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {recommendation.name}
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {recommendation.rationale}
                </p>
              </div>
              <div className="text-xs text-slate-500 max-h-32 overflow-y-auto space-y-1">
                {recommendation.channelIds.map((cid, idx) => {
                  const ch = channelMap.get(cid);
                  return (
                    <div key={cid} className="truncate">
                      <span className="font-mono text-slate-400 mr-1.5">
                        {idx + 1}.
                      </span>
                      <span className="text-slate-800">{ch?.name ?? cid}</span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => onCreatePlaylistFromSuggestion(recommendation)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                <ListPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Als Playlist speichern ({recommendation.channelIds.length})</span>
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
