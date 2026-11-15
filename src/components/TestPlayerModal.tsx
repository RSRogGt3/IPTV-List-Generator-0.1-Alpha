import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Hls from 'hls.js';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  MonitorPlay,
  Play,
  RefreshCw,
  Tv,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { buildStreamUrl, isPrivateIPv4, isValidUpstreamUrl } from '../lib/ipUtils';
import {
  Channel,
  ChannelReachabilityResult,
  PROVIDER_META,
} from '../lib/types';

export type PlayerSourceMode = 'channel' | 'relay' | 'custom' | 'testcard';

interface TestPlayerModalProps {
  open: boolean;
  channels: Channel[];
  initialChannelId: string | null;
  contextTitle?: string;
  onEditChannel?: (channel: Channel) => void;
  onClose: () => void;
}

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export function TestPlayerModal({
  open,
  channels,
  initialChannelId,
  contextTitle,
  onEditChannel,
  onClose,
}: TestPlayerModalProps) {
  const [activeChannelId, setActiveChannelId] = useState<string>('');
  const [sourceMode, setSourceMode] = useState<PlayerSourceMode>('channel');
  const [customUrl, setCustomUrl] = useState('');
  const [useRelayForCustom, setUseRelayForCustom] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [engineLabel, setEngineLabel] = useState('Bereit');
  const [resolutionLabel, setResolutionLabel] = useState('—');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lanPreviewActive, setLanPreviewActive] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [checkingEndpoint, setCheckingEndpoint] = useState(false);
  const [reachability, setReachability] =
    useState<ChannelReachabilityResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const testCardCleanupRef = useRef<(() => void) | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const wasOpenRef = useRef(false);
  const autoRelayedChannelIdRef = useRef<string | null>(null);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current !== null) {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;

    setActiveChannelId((prev) => {
      if (!justOpened && prev && channels.some((c) => c.id === prev)) {
        return prev;
      }
      if (initialChannelId && channels.some((c) => c.id === initialChannelId)) {
        return initialChannelId;
      }
      return channels[0]?.id || '';
    });

    if (justOpened) {
      autoRelayedChannelIdRef.current = null;
      setSourceMode('channel');
      setErrorMessage(null);
      setReachability(null);
      setReloadNonce((n) => n + 1);
    }
  }, [open, initialChannelId, channels]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const activeIndex = useMemo(
    () => channels.findIndex((c) => c.id === activeChannelId),
    [channels, activeChannelId]
  );

  const activeChannel = useMemo(
    () => (activeIndex >= 0 ? channels[activeIndex] : channels[0] ?? null),
    [channels, activeIndex]
  );

  const activeStreamUrl = useMemo(() => {
    if (sourceMode === 'testcard') {
      return 'lokal://testbild-720p';
    }
    if (sourceMode === 'custom') {
      const trimmed = customUrl.trim();
      if (!trimmed) return '';
      if (useRelayForCustom && isValidUpstreamUrl(trimmed)) {
        return `/api/stream-relay?u=${encodeURIComponent(trimmed)}`;
      }
      return trimmed;
    }
    if (!activeChannel) return '';
    if (sourceMode === 'relay') {
      return activeChannel.upstreamUrl
        ? `/api/channels/${encodeURIComponent(activeChannel.id)}/stream`
        : '';
    }
    return activeChannel.upstreamUrl || buildStreamUrl(activeChannel);
  }, [activeChannel, sourceMode, customUrl, useRelayForCustom]);

  const cleanupMedia = useCallback(() => {
    clearLoadTimeout();
    if (testCardCleanupRef.current) {
      testCardCleanupRef.current();
      testCardCleanupRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
    }
  }, [clearLoadTimeout]);

  const startTestCardStream = useCallback(
    (
      video: HTMLVideoElement,
      channel: Channel | null,
      options?: { lanGatewayPreview?: boolean }
    ) => {
      const isLanPreview = Boolean(options?.lanGatewayPreview);
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setPlaybackState('error');
        setErrorMessage('Canvas-Testbild wird von diesem Browser nicht unterstützt.');
        return () => {};
      }

      const bars = [
        '#e2e8f0',
        '#eab308',
        '#06b6d4',
        '#22c55e',
        '#d946ef',
        '#ef4444',
        '#2563eb',
      ];
      let frame = 0;
      let rafId = 0;

      const draw = () => {
        frame++;
        const w = canvas.width;
        const h = canvas.height;
        const barW = w / bars.length;

        bars.forEach((color, idx) => {
          ctx.fillStyle = color;
          ctx.fillRect(idx * barW, 0, Math.ceil(barW), h * 0.68);
        });

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, h * 0.68, w, h * 0.32);

        const sweepX = (frame * 8) % w;
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(sweepX, h * 0.68, 96, 6);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(
          channel ? channel.name : 'StreamGrid DE Testsignal',
          48,
          h * 0.78
        );

        ctx.fillStyle = '#94a3b8';
        ctx.font = '22px monospace';
        const endpointText = channel
          ? `${PROVIDER_META[channel.provider].label}  |  ${buildStreamUrl(channel)}`
          : '1280x720 @ 30fps  |  EBU Testsignal';
        ctx.fillText(endpointText, 48, h * 0.85);

        const now = new Date();
        const clock = now.toLocaleTimeString('de-DE', { hour12: false });
        ctx.fillStyle = isLanPreview ? '#fbbf24' : '#38bdf8';
        ctx.fillText(
          isLanPreview
            ? `LAN-GATEWAY VORSCHAU  ·  ${clock}  ·  LOKALES HEIMNETZ`
            : `LIVE TESTBILD  ·  ${clock}  ·  FRAME ${String(frame).padStart(5, '0')}`,
          48,
          h * 0.92
        );

        rafId = window.requestAnimationFrame(draw);
      };

      draw();

      const captureFn =
        (
          canvas as HTMLCanvasElement & {
            captureStream?: (fps?: number) => MediaStream;
            mozCaptureStream?: (fps?: number) => MediaStream;
          }
        ).captureStream ||
        (
          canvas as HTMLCanvasElement & {
            mozCaptureStream?: (fps?: number) => MediaStream;
          }
        ).mozCaptureStream;

      if (!captureFn) {
        window.cancelAnimationFrame(rafId);
        setPlaybackState('error');
        setErrorMessage(
          'MediaStream captureStream wird von diesem Browser nicht unterstützt.'
        );
        return () => {};
      }

      const stream = captureFn.call(canvas, 30);
      video.srcObject = stream;
      video.muted = true;
      setEngineLabel(
        isLanPreview ? 'LAN-Gateway Vorschau (720p)' : 'Testbild (1280×720 Canvas)'
      );
      setResolutionLabel('1280×720');
      setPlaybackState('playing');
      setErrorMessage(null);
      video.play().catch(() => {
        // User can click play manually
      });

      return () => {
        window.cancelAnimationFrame(rafId);
        stream.getTracks().forEach((t) => t.stop());
      };
    },
    []
  );

  useEffect(() => {
    if (!open) {
      sessionIdRef.current += 1;
      cleanupMedia();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const currentSession = ++sessionIdRef.current;
    let cancelled = false;
    cleanupMedia();
    setErrorMessage(null);
    setLanPreviewActive(false);
    setResolutionLabel('—');

    if (sourceMode === 'testcard') {
      testCardCleanupRef.current = startTestCardStream(video, activeChannel);
      return () => {
        cancelled = true;
        if (sessionIdRef.current === currentSession) {
          sessionIdRef.current += 1;
        }
        cleanupMedia();
      };
    }

    if (sourceMode === 'relay' && activeChannel && !activeChannel.upstreamUrl) {
      setPlaybackState('error');
      setEngineLabel('CORS-Relay');
      setErrorMessage(
        'Für diesen Kanal ist keine externe Upstream-URL hinterlegt. Hinterlege eine HTTP(S)-Stream-URL beim Kanal oder wechsle zu „Eigene Test-URL“ / „Testbild“.'
      );
      return;
    }

    if (!activeStreamUrl) {
      setPlaybackState('idle');
      setEngineLabel('Bereit');
      if (sourceMode === 'custom') {
        setErrorMessage('Bitte eine gültige .m3u8- oder .mp4-Stream-URL eingeben.');
      }
      return;
    }

    const lowerUrl = activeStreamUrl.toLowerCase();
    if (
      lowerUrl.startsWith('udp://') ||
      lowerUrl.startsWith('rtp://') ||
      lowerUrl.startsWith('rtsp://')
    ) {
      setPlaybackState('error');
      setEngineLabel('Nicht unterstützt im Browser');
      setErrorMessage(
        `Browser können ${lowerUrl.split('://')[0].toUpperCase()}-Streams nicht direkt abspielen. Nutze VLC / Kodi / TiviMate über den M3U-Export oder hinterlege eine HTTP(S)/HLS-Upstream-URL.`
      );
      return;
    }

    setPlaybackState('loading');

    const startPlayback = () => {
      if (cancelled || sessionIdRef.current !== currentSession) return;

      const hasRemoteStream =
        Boolean(activeChannel?.upstreamUrl) ||
        sourceMode === 'relay' ||
        sourceMode === 'custom';
      const timeoutMs = hasRemoteStream ? 9000 : 4500;

      loadTimeoutRef.current = window.setTimeout(() => {
        if (sessionIdRef.current !== currentSession) return;
        sessionIdRef.current += 1;
        cleanupMedia();
        const isPrivateLan =
          activeChannel &&
          !activeChannel.upstreamUrl &&
          sourceMode === 'channel' &&
          isPrivateIPv4(activeChannel.ip);

        setPlaybackState('error');
        setErrorMessage(
          isPrivateLan
            ? `Lokales Heimnetz-Gateway (${activeChannel.ip}:${activeChannel.port}) ist außerhalb des LAN nicht direkt abrufbar.`
            : 'Zeitüberschreitung (9s): Der Stream-Endpunkt antwortet nicht. Prüfe die URL, aktiviere das Server CORS-Relay oder starte das Testbild.'
        );
      }, timeoutMs);

      const isDirectVideoFile = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(lowerUrl);
      const looksLikeHls =
        lowerUrl.includes('.m3u8') ||
        lowerUrl.includes('/stream') ||
        lowerUrl.includes('/api/stream-relay') ||
        lowerUrl.includes('jmp2.uk') ||
        (Boolean(activeChannel?.upstreamUrl) &&
          sourceMode === 'channel' &&
          !isDirectVideoFile);

      if (looksLikeHls && Hls.isSupported()) {
        setEngineLabel(
          sourceMode === 'relay' || activeStreamUrl.startsWith('/api/')
            ? 'HLS.js + Server-Relay'
            : 'HLS.js (MSE)'
        );
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          manifestLoadingTimeOut: 9000,
          fragLoadingTimeOut: 9000,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (sessionIdRef.current !== currentSession) return;
          video.play().catch(() => {
            setPlaybackState('paused');
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (sessionIdRef.current !== currentSession) return;
          if (!data.fatal) return;

          if (
            sourceMode === 'channel' &&
            activeChannel?.upstreamUrl &&
            autoRelayedChannelIdRef.current !== activeChannel.id &&
            data.type === Hls.ErrorTypes.NETWORK_ERROR
          ) {
            autoRelayedChannelIdRef.current = activeChannel.id;
            clearLoadTimeout();
            hls.destroy();
            setSourceMode('relay');
            setReloadNonce((n) => n + 1);
            return;
          }

          clearLoadTimeout();
          const isPrivateLan =
            activeChannel &&
            !activeChannel.upstreamUrl &&
            sourceMode === 'channel' &&
            isPrivateIPv4(activeChannel.ip);

          if (isPrivateLan) {
            setErrorMessage(
              `Lokales Heimnetz-Gateway (${activeChannel.ip}:${activeChannel.port}) ist vom Browser außerhalb deines Heimnetzes oder ohne laufenden Stream-Server nicht erreichbar.`
            );
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setErrorMessage(
              'Stream konnte nicht geladen werden (Netzwerk-, CORS- oder 404-Fehler). Versuche den Modus „CORS-Relay“ oder prüfe den Endpunkt.'
            );
          } else {
            setErrorMessage(
              `Wiedergabe-Fehler (${data.details || data.type}).`
            );
          }
          setPlaybackState('error');
          hls.destroy();
        });

        hls.loadSource(activeStreamUrl);
        hls.attachMedia(video);
      } else {
        setEngineLabel(
          sourceMode === 'relay' ? 'HTML5 + Server-Relay' : 'Nativ HTML5'
        );
        video.src = activeStreamUrl;
        video.play().catch(() => {
          // Ignore autoplay rejection; error event handles actual load failures
        });
      }
    };

    const isPrivateLanChannel =
      sourceMode === 'channel' &&
      Boolean(activeChannel) &&
      !activeChannel?.upstreamUrl &&
      isPrivateIPv4(activeChannel!.ip);

    if (isPrivateLanChannel && activeChannel) {
      setEngineLabel('LAN-Gateway Prüfung…');
      api
        .checkEndpoints([activeChannel])
        .then((res) => {
          if (cancelled || sessionIdRef.current !== currentSession) return;
          const result = res.results[0] ?? null;
          setReachability(result);
          if (result?.status === 'reachable') {
            startPlayback();
          } else {
            setLanPreviewActive(true);
            testCardCleanupRef.current = startTestCardStream(
              video,
              activeChannel,
              { lanGatewayPreview: true }
            );
          }
        })
        .catch(() => {
          if (cancelled || sessionIdRef.current !== currentSession) return;
          setLanPreviewActive(true);
          testCardCleanupRef.current = startTestCardStream(
            video,
            activeChannel,
            { lanGatewayPreview: true }
          );
        });
    } else {
      startPlayback();
    }

    return () => {
      cancelled = true;
      if (sessionIdRef.current === currentSession) {
        sessionIdRef.current += 1;
      }
      cleanupMedia();
    };
  }, [
    open,
    activeChannel,
    activeStreamUrl,
    sourceMode,
    reloadNonce,
    cleanupMedia,
    clearLoadTimeout,
    startTestCardStream,
  ]);

  const handleVideoLoadedMetadata = () => {
    const v = videoRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      setResolutionLabel(`${v.videoWidth}×${v.videoHeight}`);
    }
  };

  const handleVideoPlaying = () => {
    clearLoadTimeout();
    setPlaybackState('playing');
    setErrorMessage(null);
    handleVideoLoadedMetadata();
  };

  const handleVideoError = () => {
    if (sourceMode === 'testcard') return;
    if (
      sourceMode === 'channel' &&
      activeChannel?.upstreamUrl &&
      autoRelayedChannelIdRef.current !== activeChannel.id
    ) {
      autoRelayedChannelIdRef.current = activeChannel.id;
      clearLoadTimeout();
      setSourceMode('relay');
      setReloadNonce((n) => n + 1);
      return;
    }
    clearLoadTimeout();
    setPlaybackState('error');
    const isPrivateLan =
      activeChannel &&
      !activeChannel.upstreamUrl &&
      sourceMode === 'channel' &&
      isPrivateIPv4(activeChannel.ip);
    if (isPrivateLan) {
      setErrorMessage(
        `Lokaler Heimnetz-Endpunkt (${activeChannel.ip}:${activeChannel.port}) antwortet nicht oder ist nur im lokalen LAN erreichbar.`
      );
    } else {
      setErrorMessage(
        'Videostream konnte nicht abgespielt werden (Format nicht unterstützt, CORS-Sperre oder Server offline).'
      );
    }
  };

  const handleSwitchChannel = (nextId: string) => {
    autoRelayedChannelIdRef.current = null;
    setActiveChannelId(nextId);
    setReachability(null);
    if (sourceMode === 'custom' || sourceMode === 'relay') {
      setSourceMode('channel');
    }
    setReloadNonce((n) => n + 1);
  };

  const handleStepChannel = (dir: -1 | 1) => {
    if (channels.length === 0) return;
    const baseIdx = activeIndex >= 0 ? activeIndex : 0;
    const nextIdx = (baseIdx + dir + channels.length) % channels.length;
    handleSwitchChannel(channels[nextIdx].id);
  };

  const handleCheckActiveEndpoint = async () => {
    if (!activeChannel || checkingEndpoint) return;
    setCheckingEndpoint(true);
    try {
      const res = await api.checkEndpoints([activeChannel]);
      setReachability(res.results[0] ?? null);
    } catch {
      setReachability(null);
    } finally {
      setCheckingEndpoint(false);
    }
  };

  const handleCopyActiveUrl = async () => {
    if (!activeStreamUrl) return;
    try {
      await navigator.clipboard.writeText(activeStreamUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleCustomSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSourceMode('custom');
    setReloadNonce((n) => n + 1);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/65"
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-player-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MonitorPlay
                className="w-4 h-4 text-blue-600 shrink-0"
                aria-hidden="true"
              />
              <h2
                id="test-player-title"
                className="font-display text-base font-semibold text-slate-900 truncate"
              >
                Test-Video-Player{contextTitle ? ` · ${contextTitle}` : ''}
              </h2>
            </div>
            {activeChannel && (
              <div className="mt-0.5 text-xs text-slate-500 truncate">
                {activeChannel.name} · {PROVIDER_META[activeChannel.provider].shortLabel} ·{' '}
                <span className="font-mono tabular-nums">
                  {activeChannel.ip}:{activeChannel.port}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Test-Video-Player schließen"
            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-5 space-y-4">
          {/* Channel Switcher Toolbar */}
          {channels.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <label
                  htmlFor="player-channel-select"
                  className="text-xs font-semibold text-slate-700 shrink-0"
                >
                  Kanal:
                </label>
                <select
                  id="player-channel-select"
                  value={activeChannel?.id ?? ''}
                  onChange={(e) => handleSwitchChannel(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-slate-200 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} ({PROVIDER_META[ch.provider].shortLabel} · {ch.ip}:{ch.port})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={channels.length < 2}
                  onClick={() => handleStepChannel(-1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Vorheriger</span>
                </button>
                <button
                  type="button"
                  disabled={channels.length < 2}
                  onClick={() => handleStepChannel(1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <span>Nächster</span>
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* 16:9 Dark Broadcast Viewport */}
          <div className="relative aspect-video w-full bg-slate-950 rounded-md overflow-hidden border border-slate-800">
            <video
              ref={videoRef}
              controls
              playsInline
              onLoadedMetadata={handleVideoLoadedMetadata}
              onPlaying={handleVideoPlaying}
              onPause={() => {
                if (playbackState === 'playing') setPlaybackState('paused');
              }}
              onWaiting={(e) => {
                const el = e.currentTarget;
                if (
                  sourceMode !== 'testcard' &&
                  (el.hasAttribute('src') || el.srcObject) &&
                  playbackState !== 'error'
                ) {
                  setPlaybackState('loading');
                }
              }}
              onError={(e) => {
                const el = e.currentTarget;
                if (!el.hasAttribute('src') && !el.srcObject) return;
                handleVideoError();
              }}
              className="w-full h-full object-contain bg-black"
            />

            {playbackState === 'loading' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 text-white px-4 text-center">
                <Loader2
                  className="w-7 h-7 animate-spin text-blue-400 mb-2"
                  aria-hidden="true"
                />
                <div className="text-sm font-medium">
                  Verbinde mit Stream-Endpunkt…
                </div>
                <div className="mt-1 font-mono text-xs text-slate-300 max-w-md truncate">
                  {activeStreamUrl}
                </div>
              </div>
            )}

            {playbackState === 'error' && errorMessage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white p-6 text-center">
                <WifiOff
                  className="w-8 h-8 text-amber-400 mb-2.5"
                  aria-hidden="true"
                />
                <div className="text-sm font-semibold text-white max-w-lg">
                  Stream im Browser nicht abspielbar
                </div>
                <p className="mt-1.5 text-xs text-slate-300 max-w-lg leading-relaxed">
                  {errorMessage}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {activeChannel?.upstreamUrl && sourceMode !== 'relay' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSourceMode('relay');
                        setReloadNonce((n) => n + 1);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Über Server CORS-Relay testen</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode('testcard');
                      setReloadNonce((n) => n + 1);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white rounded-md hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    <Tv className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Testbild-Signal (720p) starten</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReloadNonce((n) => n + 1)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 border border-slate-700 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Erneut versuchen</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Source Mode Switcher */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Wiedergabequelle wählen"
              className="flex items-center gap-1 p-1 bg-slate-100 rounded-md overflow-x-auto"
            >
              {(
                [
                  { id: 'channel', label: 'Kanal-Quelle' },
                  { id: 'relay', label: 'Server CORS-Relay' },
                  { id: 'custom', label: 'Eigene Test-URL' },
                  { id: 'testcard', label: 'Testbild (720p)' },
                ] as { id: PlayerSourceMode; label: string }[]
              ).map((tab) => {
                const active = sourceMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      if (tab.id === 'channel') {
                        autoRelayedChannelIdRef.current = null;
                      }
                      setSourceMode(tab.id);
                      setReloadNonce((n) => n + 1);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Neu laden</span>
              </button>
              <button
                type="button"
                disabled={!activeChannel || checkingEndpoint}
                onClick={handleCheckActiveEndpoint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {checkingEndpoint ? (
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>Endpunkt prüfen</span>
              </button>
            </div>
          </div>

          {/* Custom URL Form when 'custom' mode is active */}
          {sourceMode === 'custom' && (
            <form
              onSubmit={handleCustomSubmit}
              className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://beispiel.de/live/stream.m3u8 oder .mp4"
                  aria-label="Test-Stream-URL eingeben"
                  className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Stream laden</span>
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRelayForCustom}
                  onChange={(e) => setUseRelayForCustom(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  Über Server CORS-Relay laden (umgeht CORS-Blockaden externer Anbieter)
                </span>
              </label>
            </form>
          )}

          {/* Diagnostic & Telemetry Bar */}
          <div className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-500 block">Player-Status</span>
              <span className="mt-0.5 inline-flex items-center gap-1.5 font-medium text-slate-900">
                {playbackState === 'playing' ? (
                  <CheckCircle2
                    className="w-3.5 h-3.5 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : playbackState === 'error' ? (
                  <AlertTriangle
                    className="w-3.5 h-3.5 text-amber-600"
                    aria-hidden="true"
                  />
                ) : (
                  <Play
                    className="w-3.5 h-3.5 text-slate-500"
                    aria-hidden="true"
                  />
                )}
                <span>
                  {playbackState === 'playing'
                    ? 'Wiedergabe aktiv'
                    : playbackState === 'loading'
                      ? 'Verbinde...'
                      : playbackState === 'paused'
                        ? 'Pausiert'
                        : playbackState === 'error'
                          ? 'Nicht erreichbar'
                          : 'Bereit'}
                </span>
              </span>
            </div>

            <div>
              <span className="text-slate-500 block">Engine & Auflösung</span>
              <span className="mt-0.5 block font-mono text-slate-900 tabular-nums">
                {engineLabel} · {resolutionLabel}
              </span>
            </div>

            <div>
              <span className="text-slate-500 block">Aktive Stream-URL</span>
              <div className="mt-0.5 flex items-center gap-1.5">
                <code
                  title={activeStreamUrl}
                  className="font-mono text-slate-800 truncate block flex-1"
                >
                  {activeStreamUrl || '—'}
                </code>
                {activeStreamUrl && (
                  <button
                    type="button"
                    onClick={handleCopyActiveUrl}
                    aria-label="Aktive Stream-URL kopieren"
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                  >
                    {copiedUrl ? (
                      <Check
                        className="w-3.5 h-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {lanPreviewActive && activeChannel && (
            <div className="px-3.5 py-2.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>
                  <strong>Lokales Heimnetz-Gateway ({activeChannel.ip}:{activeChannel.port}):</strong>{' '}
                  Pay-TV/Streaming-Dienste (Netflix, Disney+, Amazon Prime, Sky) senden aus DRM-Gründen keine offenen öffentlichen Live-Streams. Im Player läuft die lokale Gateway-Vorschau.
                </span>
              </div>
              {onEditChannel && (
                <button
                  type="button"
                  onClick={() => onEditChannel(activeChannel)}
                  className="px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-md hover:bg-amber-100 whitespace-nowrap shrink-0"
                >
                  Upstream-URL hinterlegen
                </button>
              )}
            </div>
          )}

          {reachability && (
            <div className="px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center gap-2 tabular-nums">
              {reachability.status === 'reachable' ? (
                <CheckCircle2
                  className="w-4 h-4 text-emerald-600 shrink-0"
                  aria-hidden="true"
                />
              ) : reachability.status === 'private-lan' ? (
                <AlertTriangle
                  className="w-4 h-4 text-amber-600 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <WifiOff
                  className="w-4 h-4 text-red-600 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>
                <strong>Server-Check:</strong> {reachability.detail}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
