import { useVoiceAgent, type VoiceStatus } from "agents/voice/react";
import {
  MicrophoneIcon,
  PhoneIcon,
  PhoneDisconnectIcon,
  WaveformIcon,
  SpinnerGapIcon,
  SpeakerHighIcon,
  ChatCircleDotsIcon,
  WifiHighIcon,
  WifiSlashIcon,
  WarningCircleIcon,
  UserSwitchIcon,
  PaperPlaneRightIcon,
  BroadcastIcon,
  MoonIcon,
  SunIcon
} from "@phosphor-icons/react";
import {
  Button,
  Input,
  Surface,
  Text,
  PoweredByCloudflare
} from "@cloudflare/kumo";
import {
  useEffect,
  useRef,
  useState,
  useCallback
} from "react";
import type {
  PointerEvent as ReactPointerEvent,
  CSSProperties
} from "react";
import { useSFUVoice } from "./use-sfu-voice";
import {
  DEFAULT_STT_SETTINGS,
  ProviderSettings,
  getSttQuery,
  type SttSettings
} from "./stt-settings";
import { createRoot } from "react-dom/client";
import { downloadLearningMaterials } from "./learning-export";
import "./styles.css";

// --- Session ID ---
// Each browser tab gets a persistent session ID stored in localStorage.
// This is used as the agent instance name, so the same user always
// reconnects to the same agent (preserving conversation history).

function getSessionId(): string {
  const KEY = "voice-agent-session-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// --- Helpers ---

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getStatusDisplay(status: VoiceStatus) {
  switch (status) {
    case "idle":
      return {
        text: "Ready",
        icon: PhoneIcon,
        color: "text-kumo-secondary"
      };
    case "listening":
      return {
        text: "Listening...",
        icon: WaveformIcon,
        color: "text-kumo-success"
      };
    case "thinking":
      return {
        text: "Thinking...",
        icon: SpinnerGapIcon,
        color: "text-kumo-warning"
      };
    case "speaking":
      return {
        text: "Speaking...",
        icon: SpeakerHighIcon,
        color: "text-kumo-info"
      };
  }
}

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

// --- Push-to-Talk button ---
// The mic is MUTED by default during a call. The child holds this button to
// unmute (audio flows to ASR), and releases to re-mute. Because Workers AI
// Flux STT is billed by audio duration, this stops idle "listening" from
// burning neurons and makes the cost predictable: you only pay for the
// seconds the child actually holds the button.

function PushToTalkButton({
  disabled,
  onPressStart,
  onPressEnd
}: {
  disabled: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);

  const start = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || pressedRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    pressedRef.current = true;
    setPressed(true);
    onPressStart();
  };

  const end = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pressedRef.current) return;
    e.preventDefault();
    pressedRef.current = false;
    setPressed(false);
    onPressEnd();
  };

  return (
    <button
      type="button"
      className={`ptt-button${pressed ? " ptt-button--active" : ""}`}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none", userSelect: "none" } as CSSProperties}
    >
      <span className="ptt-icon">
        <MicrophoneIcon size={30} weight="fill" />
      </span>
      <span className="ptt-label">{pressed ? "正在说话…" : "按住说话"}</span>
      <span className="ptt-hint">
        {pressed ? "松手就结束" : "长按开始 · 松手结束"}
      </span>
    </button>
  );
}

// --- WebRTC (SFU) Mode ---

type LlmModel = "kimi" | "glm" | "gpt-oss-20b";

function getAudioOutputLabel(device: MediaDeviceInfo, index: number) {
  if (device.deviceId === "default") return "System default";
  if (device.deviceId === "communications") return "Communications default";
  return device.label || `Speaker ${index + 1}`;
}

function WebRTCApp({
  llmModel,
  onLlmModelChange,
  sttSettings,
  onSttSettingsChange,
  lang,
  onLangToggle
}: {
  llmModel: LlmModel;
  onLlmModelChange: (m: LlmModel) => void;
  sttSettings: SttSettings;
  onSttSettingsChange: (settings: SttSettings) => void;
  lang: "en" | "zh";
  onLangToggle: () => void;
}) {
  const sessionId = useRef(getSessionId()).current;

  const {
    status,
    transcript,
    metrics,
    audioLevel,
    isMuted,
    connected,
    error,
    webrtcState,
    startCall,
    endCall,
    toggleMute,
    sendText
  } = useSFUVoice({
    agent: "my-voice-agent",
    name: sessionId,
    query: { llm: llmModel, ...getSttQuery(sttSettings), lang }
  });

  // Restart the call when the language mode changes, so the new prompt applies.
  const prevLangRef = useRef(lang);
  // When a call (re)starts, force it into the muted state so no audio is sent
  // to ASR until the child presses the push-to-talk button.
  const needsInitialMuteRef = useRef(false);
  useEffect(() => {
    if (prevLangRef.current !== lang) {
      prevLangRef.current = lang;
      if (status !== "idle") {
        endCall();
        needsInitialMuteRef.current = true;
        const t = window.setTimeout(() => startCall(), 500);
        return () => window.clearTimeout(t);
      }
    }
  }, [lang]);

  // Ensure a freshly-started call begins muted (push-to-talk default).
  useEffect(() => {
    if (needsInitialMuteRef.current && isInCall && !isMuted) {
      needsInitialMuteRef.current = false;
      toggleMute();
    }
  }, [isInCall, isMuted, toggleMute]);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [textInput, setTextInput] = useState("");

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const isInCall = status !== "idle";
  const statusDisplay = getStatusDisplay(status);
  const StatusIcon = statusDisplay.icon;

  const handleStartCallWebRTC = useCallback(async () => {
    needsInitialMuteRef.current = true;
    await startCall();
  }, [startCall]);

  // Press-to-talk: hold to unmute (audio → ASR), release to re-mute.
  const handlePttStart = useCallback(() => {
    if (!isMuted) return;
    toggleMute();
  }, [isMuted, toggleMute]);

  const handlePttEnd = useCallback(() => {
    if (isMuted) return;
    toggleMute();
  }, [isMuted, toggleMute]);

  return (
    <>
      {/* WebRTC status badge */}
      <div className="mb-4 flex items-center justify-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            webrtcState === "connected"
              ? "bg-green-500/10 text-green-600"
              : webrtcState === "checking" || webrtcState === "new"
                ? "bg-amber-500/10 text-amber-600"
                : "bg-kumo-fill text-kumo-secondary"
          }`}
        >
          <BroadcastIcon size={14} weight="bold" />
          WebRTC: {webrtcState}
        </span>
      </div>

      {/* LLM model selector */}
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="text-xs text-kumo-secondary">LLM:</span>
        <Button
          variant={llmModel === "glm" ? "primary" : "ghost"}
          size="sm"
          disabled={isInCall}
          onClick={() => onLlmModelChange("glm")}
        >
          GLM
        </Button>
        <Button
          variant={llmModel === "gpt-oss-20b" ? "primary" : "ghost"}
          size="sm"
          disabled={isInCall}
          onClick={() => onLlmModelChange("gpt-oss-20b")}
        >
          GPT-OSS 20B
        </Button>
        <Button
          variant={llmModel === "kimi" ? "primary" : "ghost"}
          size="sm"
          disabled={isInCall}
          onClick={() => onLlmModelChange("kimi")}
        >
          Kimi
        </Button>
      </div>

      {/* Language mode + export (child-friendly big buttons) */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant={lang === "zh" ? "primary" : "ghost"}
          size="lg"
          className="buddy-big-btn"
          onClick={onLangToggle}
        >
          {lang === "zh" ? "🀄 中文解释中" : "🗣️ 切换中文解释"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="buddy-big-btn"
          onClick={() => downloadLearningMaterials(transcript, sessionId)}
        >
          📚 导出学习资料
        </Button>
      </div>

      <ProviderSettings
        settings={sttSettings}
        disabled={isInCall}
        onChange={onSttSettingsChange}
      />

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Status indicator */}
      <Surface className="rounded-xl px-4 py-3 text-center ring ring-kumo-line mb-4">
        <div
          className={`flex items-center justify-center gap-2 ${statusDisplay.color}`}
        >
          <StatusIcon
            size={20}
            weight="bold"
            className={status === "thinking" ? "animate-spin" : ""}
          />
          <span className={`text-lg ${statusDisplay.color}`}>
            {isInCall && isMuted && status === "listening"
              ? "按住说话 🎤"
              : statusDisplay.text}
          </span>
        </div>
        {isInCall && status === "listening" && !isMuted && (
          <div className="mt-2 h-1.5 bg-kumo-fill rounded-full overflow-hidden">
            <div
              className="h-full bg-kumo-success rounded-full transition-all duration-75"
              style={{ width: `${Math.min(audioLevel * 500, 100)}%` }}
            />
          </div>
        )}
      </Surface>

      {/* Metrics */}
      {metrics && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-kumo-secondary font-mono">
          <span>
            LLM <span className="text-kumo-default">{metrics.llm_ms}ms</span>
          </span>
          <span className="text-kumo-line">/</span>
          <span>
            TTS <span className="text-kumo-default">{metrics.tts_ms}ms</span>
          </span>
          <span className="text-kumo-line">/</span>
          <span>
            First audio{" "}
            <span className="text-kumo-default">
              {metrics.first_audio_ms}ms
            </span>
          </span>
        </div>
      )}

      {/* Transcript */}
      <Surface className="rounded-xl ring ring-kumo-line mb-6 h-72 overflow-y-auto">
        {transcript.length === 0 ? (
          <div className="h-full flex items-center justify-center text-kumo-secondary">
            <Text size="sm">
              {isInCall
                ? "Start speaking..."
                : connected
                  ? "Click Call to start via WebRTC"
                  : "Connecting to agent..."}
            </Text>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {transcript.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="flex flex-col gap-0.5 max-w-[80%]">
                  <div
                    className={`rounded-xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-kumo-brand/15 text-kumo-default"
                        : "bg-kumo-fill text-kumo-default"
                    }`}
                  >
                    {msg.text || (
                      <span className="text-kumo-secondary italic">...</span>
                    )}
                  </div>
                  {msg.timestamp && (
                    <span
                      className={`text-[10px] text-kumo-secondary px-1 ${msg.role === "user" ? "text-right" : "text-left"}`}
                    >
                      {formatTime(new Date(msg.timestamp))}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </Surface>

      {/* Controls */}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        {!isInCall ? (
          <Button
            onClick={handleStartCallWebRTC}
            className="px-8 justify-center buddy-big-btn"
            variant="primary"
            disabled={!connected}
            icon={<PhoneIcon size={20} weight="fill" />}
          >
            {connected ? "Start Call (WebRTC)" : "Connecting..."}
          </Button>
        ) : (
          <>
            <PushToTalkButton
              onPressStart={handlePttStart}
              onPressEnd={handlePttEnd}
            />
            <Button
              onClick={endCall}
              variant="destructive"
              icon={<PhoneDisconnectIcon size={20} weight="fill" />}
            >
              End Call
            </Button>
          </>
        )}
      </div>

      {/* Text input */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (textInput.trim() && connected) {
            sendText(textInput.trim());
            setTextInput("");
          }
        }}
      >
        <Input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={connected ? "Type a message..." : "Connecting..."}
          disabled={!connected || status === "thinking"}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!connected || !textInput.trim() || status === "thinking"}
          icon={<PaperPlaneRightIcon size={16} weight="fill" />}
        >
          Send
        </Button>
      </form>

      {/* Session info */}
      <div className="mt-4 text-center text-[10px] text-kumo-secondary font-mono">
        Session: {sessionId.slice(0, 8)}... (WebRTC/SFU)
      </div>
    </>
  );
}

// --- Main App ---

function App() {
  const sessionId = useRef(getSessionId()).current;
  const [transport, setTransport] = useState<"websocket" | "webrtc">(
    "websocket"
  );
  const [sttSettings, setSttSettings] =
    useState<SttSettings>(DEFAULT_STT_SETTINGS);
  const [llmModel, setLlmModel] = useState<LlmModel>("glm");
  const [outputDeviceId, setOutputDeviceId] = useState("default");
  const [lang, setLang] = useState<"en" | "zh">("en");

  const {
    status,
    transcript,
    interimTranscript,
    metrics,
    audioLevel,
    isMuted,
    connected,
    error,
    outputDeviceError,
    startCall,
    endCall,
    toggleMute,
    sendText
  } = useVoiceAgent({
    agent: "my-voice-agent",
    name: sessionId,
    query: { llm: llmModel, ...getSttQuery(sttSettings), lang },
    outputDeviceId,
    onReconnect: () => {
      setToast("Reconnected to agent.");
    }
  });

  // When the language mode changes and a call is active, restart the call so
  // the new system prompt (English teaching vs. Chinese explanation) takes effect.
  const prevLangRef = useRef(lang);
  // When a call (re)starts, force it into the muted state so no audio is sent
  // to ASR until the child presses the push-to-talk button.
  const needsInitialMuteRef = useRef(false);
  useEffect(() => {
    if (prevLangRef.current !== lang) {
      prevLangRef.current = lang;
      if (status !== "idle") {
        endCall();
        needsInitialMuteRef.current = true;
        const t = window.setTimeout(() => startCall(), 500);
        return () => window.clearTimeout(t);
      }
    }
  }, [lang]);

  // Ensure a freshly-started call begins muted (push-to-talk default).
  useEffect(() => {
    if (needsInitialMuteRef.current && isInCall && !isMuted) {
      needsInitialMuteRef.current = false;
      toggleMute();
    }
  }, [isInCall, isMuted, toggleMute]);

  const toggleLang = useCallback(() => {
    setLang((prev) => (prev === "en" ? "zh" : "en"));
  }, []);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [textInput, setTextInput] = useState("");
  const [speakerConflict, setSpeakerConflict] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [audioOutputDevices, setAudioOutputDevices] = useState<
    MediaDeviceInfo[]
  >([]);

  // Listen for custom protocol messages (speaker_conflict, kicked, speaker_available)
  // by observing the VoiceClient's raw message events. Since useVoiceAgent abstracts
  // the socket, we listen via a separate lightweight connection.
  // We handle custom messages by intercepting the error field.
  // The VoiceClient passes unknown JSON to onNonVoiceMessage, but that only
  // fires on the server. For client-side custom messages, we need to handle
  // the "error" event from VoiceClient (which passes server errors) and also
  // check for our custom types. A cleaner approach: use a separate VoiceClient
  // for monitoring custom messages. For this example, we watch the error field
  // and handle speaker conflict via the error banner pattern.

  // Actually, VoiceClient's handleJSONMessage silently ignores unknown types.
  // So speaker_conflict/kicked/speaker_available don't update any VoiceClient
  // state. We need to listen at a lower level. The simplest approach: create
  // a lightweight companion connection for custom events.
  //
  // For now, we take a simpler approach: the server sends speaker_conflict
  // as an "error" type message, which VoiceClient surfaces via the error field.

  // Auto-clear toasts
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const refreshAudioOutputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioOutputDevices(
      devices.filter((device) => device.kind === "audiooutput")
    );
  }, []);

  useEffect(() => {
    refreshAudioOutputs().catch(() => {
      setToast("Could not list speakers for this browser.");
    });

    navigator.mediaDevices?.addEventListener(
      "devicechange",
      refreshAudioOutputs
    );
    return () => {
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshAudioOutputs
      );
    };
  }, [refreshAudioOutputs]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interimTranscript]);

  const handleStartCall = useCallback(async () => {
    needsInitialMuteRef.current = true;
    await startCall();
    await refreshAudioOutputs().catch(() => {});
  }, [refreshAudioOutputs, startCall]);

  // Press-to-talk: hold to unmute (audio → ASR), release to re-mute.
  const handlePttStart = useCallback(() => {
    if (!isMuted) return;
    toggleMute();
  }, [isMuted, toggleMute]);

  const handlePttEnd = useCallback(() => {
    if (isMuted) return;
    toggleMute();
  }, [isMuted, toggleMute]);

  // Detect speaker conflict from error messages
  useEffect(() => {
    if (
      error &&
      (error.includes("active speaker") || error.includes("speaker"))
    ) {
      setSpeakerConflict(true);
    }
    if (error && error.includes("taken over")) {
      setKicked(true);
      setSpeakerConflict(false);
    }
  }, [error]);

  const handleKickSpeaker = useCallback(() => {
    // Kick the current speaker via a direct RPC call to the agent instance.
    // The server's onMessage intercepts { type: "kick_speaker" } before the
    // voice protocol handles it, so a raw POST is enough — no VoiceClient needed.
    setSpeakerConflict(false);
    setKicked(false);
    setToast("Attempting to take over as speaker...");

    fetch(`/agents/my-voice-agent/${sessionId}?action=kick`, {
      method: "POST"
    }).catch(() => {
      // If the RPC fails, just reload
      window.location.reload();
    });
  }, [sessionId]);

  const isInCall = status !== "idle";
  const statusDisplay = getStatusDisplay(status);
  const StatusIcon = statusDisplay.icon;

  // If WebRTC transport is selected, render the SFU app
  if (transport === "webrtc") {
    return (
      <div className="min-h-full flex items-center justify-center p-6 buddy-app">
        <Surface className="w-full max-w-lg rounded-2xl p-8 ring ring-kumo-line buddy-card">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <BroadcastIcon
                size={28}
                weight="duotone"
                className="text-kumo-brand"
              />
              <h1 className="buddy-title">Buddy 英语老师</h1>
            </div>
            <div className="flex items-center gap-3">
              <ModeToggle />
            </div>
          </div>

          {/* Transport toggle */}
          <div className="mb-4 flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<WifiHighIcon size={14} />}
              onClick={() => setTransport("websocket")}
            >
              WebSocket
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<BroadcastIcon size={14} />}
            >
              WebRTC (SFU)
            </Button>
          </div>

          <WebRTCApp
            llmModel={llmModel}
            onLlmModelChange={setLlmModel}
            sttSettings={sttSettings}
            onSttSettingsChange={setSttSettings}
            lang={lang}
            onLangToggle={toggleLang}
          />

          {/* Footer */}
          <div className="mt-4 flex justify-center">
            <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
          </div>
        </Surface>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Surface className="w-full max-w-lg rounded-2xl p-8 ring ring-kumo-line">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ChatCircleDotsIcon
              size={28}
              weight="duotone"
              className="text-kumo-brand"
            />
            <h1 className="buddy-title">Buddy 英语老师</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <span
              className={`flex items-center gap-1.5 text-xs ${connected ? "text-kumo-success" : "text-kumo-secondary"}`}
            >
              {connected ? (
                <WifiHighIcon size={14} weight="bold" />
              ) : (
                <WifiSlashIcon size={14} weight="bold" />
              )}
              {connected ? "Connected" : "Connecting..."}
            </span>
            <ModeToggle />
          </div>
        </div>

        {/* Transport toggle */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <Button variant="primary" size="sm" icon={<WifiHighIcon size={14} />}>
            WebSocket
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<BroadcastIcon size={14} />}
            onClick={() => setTransport("webrtc")}
          >
            WebRTC (SFU)
          </Button>
        </div>

      {/* Language mode + export (child-friendly big buttons) */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant={lang === "zh" ? "primary" : "ghost"}
          size="lg"
          className="buddy-big-btn"
          onClick={toggleLang}
        >
          {lang === "zh" ? "🀄 中文解释中" : "🗣️ 切换中文解释"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="buddy-big-btn"
          onClick={() => downloadLearningMaterials(transcript, sessionId)}
        >
          📚 导出学习资料
        </Button>
      </div>

      <ProviderSettings
        settings={sttSettings}
        disabled={isInCall}
        onChange={setSttSettings}
      />

        {/* LLM model selector */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <span className="text-xs text-kumo-secondary">LLM:</span>
          <Button
            variant={llmModel === "glm" ? "primary" : "ghost"}
            size="sm"
            disabled={isInCall}
            onClick={() => setLlmModel("glm")}
          >
            GLM
          </Button>
          <Button
            variant={llmModel === "gpt-oss-20b" ? "primary" : "ghost"}
            size="sm"
            disabled={isInCall}
            onClick={() => setLlmModel("gpt-oss-20b")}
          >
            GPT-OSS 20B
          </Button>
          <Button
            variant={llmModel === "kimi" ? "primary" : "ghost"}
            size="sm"
            disabled={isInCall}
            onClick={() => setLlmModel("kimi")}
          >
            Kimi
          </Button>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400">
            {toast}
          </div>
        )}

        {/* Error banner */}
        {error && !speakerConflict && !kicked && (
          <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Speaker conflict banner */}
        {speakerConflict && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 mb-2">
              <WarningCircleIcon size={16} weight="bold" />
              Another session is currently the active speaker.
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<UserSwitchIcon size={16} />}
              onClick={handleKickSpeaker}
            >
              Take over as speaker
            </Button>
          </div>
        )}

        {/* Kicked banner */}
        {kicked && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <WarningCircleIcon size={16} weight="bold" />
              Another session has taken over. You have been disconnected.
            </div>
          </div>
        )}

        {/* Status indicator */}
        <Surface className="rounded-xl px-4 py-3 text-center ring ring-kumo-line mb-4">
          <div
            className={`flex items-center justify-center gap-2 ${statusDisplay.color}`}
          >
            <StatusIcon
              size={20}
              weight="bold"
              className={status === "thinking" ? "animate-spin" : ""}
            />
            <span className={`text-lg ${statusDisplay.color}`}>
              {statusDisplay.text}
            </span>
          </div>
          {/* Audio level meter */}
          {isInCall && status === "listening" && !isMuted && (
            <div className="mt-2 h-1.5 bg-kumo-fill rounded-full overflow-hidden">
              <div
                className="h-full bg-kumo-success rounded-full transition-all duration-75"
                style={{ width: `${Math.min(audioLevel * 500, 100)}%` }}
              />
            </div>
          )}
        </Surface>

        {/* Latency metrics */}
        {metrics && (
          <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-kumo-secondary font-mono">
            <span>
              LLM <span className="text-kumo-default">{metrics.llm_ms}ms</span>
            </span>
            <span className="text-kumo-line">/</span>
            <span>
              TTS <span className="text-kumo-default">{metrics.tts_ms}ms</span>
            </span>
            <span className="text-kumo-line">/</span>
            <span>
              First audio{" "}
              <span className="text-kumo-default">
                {metrics.first_audio_ms}ms
              </span>
            </span>
          </div>
        )}

        {/* Transcript */}
        <Surface className="rounded-xl ring ring-kumo-line mb-6 h-72 overflow-y-auto buddy-transcript">
          {transcript.length === 0 ? (
            <div className="h-full flex items-center justify-center text-kumo-secondary">
              <Text size="sm">
                {isInCall
                  ? "Start speaking..."
                  : connected
                    ? "Click Call to start a conversation"
                    : "Connecting to agent..."}
              </Text>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {transcript.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className="flex flex-col gap-0.5 max-w-[80%]">
                    <div
                      className={`rounded-xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-kumo-brand/15 text-kumo-default"
                          : "bg-kumo-fill text-kumo-default"
                      }`}
                    >
                      {msg.text || (
                        <span className="text-kumo-secondary italic">...</span>
                      )}
                    </div>
                    {msg.timestamp && (
                      <span
                        className={`text-[10px] text-kumo-secondary px-1 ${msg.role === "user" ? "text-right" : "text-left"}`}
                      >
                        {formatTime(new Date(msg.timestamp))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {/* Interim transcript — live preview of what the user is saying */}
              {interimTranscript && (
                <div className="flex justify-end">
                  <div className="flex flex-col gap-0.5 max-w-[80%]">
                    <div className="rounded-xl px-3 py-2 text-sm bg-kumo-brand/10 text-kumo-secondary italic border border-kumo-brand/20 border-dashed">
                      {interimTranscript}
                    </div>
                  </div>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </Surface>

        {/* Controls */}
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <div className="flex flex-col items-center gap-1">
            <select
              aria-label="Audio output"
              value={outputDeviceId}
              onChange={(event) => setOutputDeviceId(event.target.value)}
              className="min-w-0 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
            >
              <option value="default">System default</option>
              {audioOutputDevices
                .filter((device) => device.deviceId !== "default")
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {getAudioOutputLabel(device, index)}
                  </option>
                ))}
            </select>
            {outputDeviceError && (
              <span className="max-w-48 text-center text-xs text-kumo-warning">
                {outputDeviceError}
              </span>
            )}
          </div>
          {!isInCall ? (
            <Button
              onClick={handleStartCall}
              className="px-8 justify-center buddy-big-btn"
              variant="primary"
              disabled={!connected || speakerConflict}
              icon={<PhoneIcon size={20} weight="fill" />}
            >
              {connected ? "Start Call" : "Connecting..."}
            </Button>
          ) : (
            <>
              <PushToTalkButton
                onPressStart={handlePttStart}
                onPressEnd={handlePttEnd}
              />
              <Button
                onClick={endCall}
                variant="destructive"
                icon={<PhoneDisconnectIcon size={20} weight="fill" />}
              >
                End Call
              </Button>
            </>
          )}
        </div>

        {/* Text input — type to the agent */}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (textInput.trim() && connected) {
              sendText(textInput.trim());
              setTextInput("");
            }
          }}
        >
          <Input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={connected ? "Type a message..." : "Connecting..."}
            disabled={!connected || status === "thinking"}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!connected || !textInput.trim() || status === "thinking"}
            icon={<PaperPlaneRightIcon size={16} weight="fill" />}
          >
            Send
          </Button>
        </form>

        {/* Session info */}
        <div className="mt-4 text-center text-[10px] text-kumo-secondary font-mono">
          Session: {sessionId.slice(0, 8)}...
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-center">
          <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
        </div>
      </Surface>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
