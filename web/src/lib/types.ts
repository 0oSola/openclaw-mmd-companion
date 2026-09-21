export type EmotionSlot =
  | "neutral"
  | "happy"
  | "sad"
  | "thinking"
  | "excited"
  | "caring";

export type ProceduralAction =
  | "idle"
  | "nod"
  | "wave"
  | "think"
  | "cheer"
  | "comfort"
  | "lean_in"
  | "look_away"
  | "headshake";

export type MotionStep = {
  template: string;
  duration_ms: number;
  intensity: number;
};

export type MotionPlan = {
  sequence: MotionStep[];
};

export type MappingConfig = {
  kind: "procedural" | "vmd";
  value: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  visibility?: "chat" | "internal";
  createdAt?: string;
  traceId?: string;
  tts?: {
    id?: string;
    status: "loading" | "pending" | "ready" | "failed" | "expired" | "partial_failed";
    mode: "server" | "browser";
    provider?: string;
    version?: number;
    audio?: Blob;
    mediaType?: string;
    remoteAudioUrl?: string;
    proxyAudioUrl?: string;
    durationSeconds?: number;
    taskId?: string;
    error?: string;
  };
};

export type RealtimeVoiceStatus =
  | "idle"
  | "connecting"
  | "queued"
  | "synthesizing"
  | "playing"
  | "fallback"
  | "partial_failed"
  | "failed";

export type RealtimeVoiceFallbackMode = "auto_before_playback" | "manual_after_partial_playback";

export type PodcastStatus = "ready" | "partial" | "processing" | "missing" | "failed";

export type DailyPodcast = {
  date: string;
  status: PodcastStatus;
  doc_url: string | null;
  doc_links: Record<string, string>;
  audio: {
    url: string | null;
    format: "audio/ogg" | "audio/wav" | null;
    bytes: number | null;
    source: "ogg" | "wav" | null;
  };
  counts: Record<string, number>;
  script_chars: number | null;
  updated_at: string | null;
  audio_error: string | null;
};

export type ChatResponse = {
  trace_id: string;
  text: string;
  emotion: EmotionSlot;
  action: ProceduralAction;
  motion_plan?: MotionPlan | null;
  memory_ops: Array<Record<string, unknown>>;
  parse_mode: string;
  endpoint_used: string;
  degraded: boolean;
  fallback_reason?: string | null;
};

export type MessageServiceSession = {
  id: string;
  workspace_id: string;
  account_id: string;
  openclaw_session_key: string;
  title: string;
  title_source: "default" | "manual" | "generated" | "user_first_message";
  selected_model_path?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type MessageServiceTts = {
  id: string;
  provider: string;
  version: number;
  status: "pending" | "ready" | "failed" | "expired";
  task_id?: string | null;
  remote_audio_url?: string | null;
  remote_audio_path?: string | null;
  proxy_audio_url?: string | null;
  media_type?: string | null;
  duration_seconds?: number | null;
  chunks_count?: number | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  expires_at?: string | null;
  updated_at: string;
};

export type MessageMotionResolution = {
  id: string;
  selected_model_path?: string | null;
  source_action?: string | null;
  source_template?: string | null;
  resolved_asset_id?: string | null;
  resolved_asset_url?: string | null;
  resolved_display_name?: string | null;
  status: "matched" | "fallback_idle" | "missing_asset" | "permission_denied" | "model_mismatch";
  fallback_reason?: string | null;
  created_at: string;
};

export type MessageServiceMessage = {
  id: string;
  workspace_id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  visibility?: "chat" | "internal";
  trace_id?: string | null;
  emotion?: string | null;
  action?: string | null;
  tts_emotion_label?: string | null;
  tts_pause_profile?: string | null;
  motion_plan?: MotionPlan | null;
  motion_resolution?: MessageMotionResolution | null;
  memory_ops: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  tts?: MessageServiceTts | null;
  created_at: string;
  deleted_at?: string | null;
};

export type MessageServiceSendResponse = {
  session: MessageServiceSession;
  user_message: MessageServiceMessage;
  assistant_message: MessageServiceMessage;
};

export type MessageServiceCleanupResult = {
  ok: boolean;
  counts: {
    deleted_soft_deleted_messages: number;
    deleted_soft_deleted_tts: number;
    deleted_old_terminal_tts: number;
    deleted_orphan_tts_jobs: number;
    failed_stale_pending_jobs: number;
  };
};

export type MotionContextExport = {
  id: string;
  workspace_id: string;
  account_id: string;
  model_key: string;
  model_display_name: string;
  export_json: Record<string, unknown>;
  motion_count: number;
  created_at: string;
};

export type WorkspaceContext = {
  account: {
    id: string;
    external_user_id: string;
    display_name?: string | null;
    created_at: string;
    updated_at: string;
  };
  workspace: {
    id: string;
    name: string;
    kind: string;
    owner_account_id: string;
    created_at: string;
    updated_at: string;
  };
  membership: {
    workspace_id: string;
    account_id: string;
    role: string;
    created_at: string;
  };
};

export type VmdAsset = {
  asset_id: string;
  user_id: string;
  slot: EmotionSlot;
  filename: string;
  display_name: string;
  source_relative_path?: string | null;
  is_favorite: boolean;
  favorite_model_paths?: string[];
  favorite_relative_path?: string | null;
  favorite_model_relative_path?: string | null;
  size_bytes: number;
  created_at: string;
  motion_profile?: {
    lower_body_motion_score: number;
    lower_body_track_count: number;
    companion_safe: boolean;
  };
  url: string;
};

export type MmdModelAsset = {
  name: string;
  label: string;
  relative_path: string;
  size_bytes: number;
  url: string;
};

export type MmdMotionAsset = {
  name: string;
  label: string;
  relative_path: string;
  size_bytes: number;
  url: string;
};

export type RenderPipeline = "classic" | "hero-shot" | "genshin" | "mio-reference" | "reze-npr" | "reze-design" | "k3" | "reze-k3" | "v14d-game";

export type CompanionSharedConfig = {
  user_id: string;
  selected_model_path: string | null;
  render_pipeline: RenderPipeline;
  reze_stage_document: Record<string, unknown> | null;
  updated_at: string | null;
};

export type MmdCameraSnapshot = {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
  locked: boolean;
};

export type TraceEvent = {
  trace_id: string;
  user_id: string;
  session_id: string | null;
  stage: string;
  status: string;
  latency_ms: number | null;
  error_code: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TraceMirror = {
  trace_id: string;
  user_id: string;
  request: Record<string, unknown>;
  raw_response: string;
  normalized: Record<string, unknown>;
  endpoint_used: string;
  status: string;
  created_at: string;
};

export type UserSession = {
  userId: string;
  token?: string;
  activeChatSessionId?: string;
  renderPipeline?: RenderPipeline;
  ttsEnabled?: boolean;
  ttsMode?: "browser" | "server";
  mmdCamera?: Partial<Record<RenderPipeline, MmdCameraSnapshot>>;
  mmdCameraByFavoriteVmd?: Record<string, MmdCameraSnapshot>;
};

export type OpenClawConfig = {
  base_url: string;
  token_configured: boolean;
  agent_id: string;
  model: string;
  message_channel: string;
  proxy_url: string;
  verify_ssl: boolean;
  timeout_seconds: number;
};

export type OpenClawConfigSaveResult = OpenClawConfig & {
  restart_required: boolean;
  message: string;
};

export type OpenClawProbeStatus = {
  ok: boolean | null;
  status_code: number | null;
  detail: string;
  endpoint: string;
};

export type OpenClawHealthStatus = {
  ok: boolean;
  base_url: string;
  agent_id: string;
  model: string;
  proxy_configured: boolean;
  verify_ssl: boolean;
  scope_header_enabled: boolean;
  probes: Record<string, OpenClawProbeStatus>;
  recommendations: string[];
};

export type MessageBridgeBinding = {
  id: string;
  local_session_id: string;
  provider: string;
  channel: string;
  external_session_key: string;
  external_display_name?: string | null;
  is_default: boolean;
  status: string;
  last_history_sync_at?: string | null;
  last_message_at?: string | null;
  updated_at: string;
};

export type MessageBridgeStatus = {
  provider: string;
  channel: string;
  enabled: boolean;
  realtime_drive_character: boolean;
  websocket_status: string;
  reconnect_attempts: number;
  last_connected_at?: string | null;
  last_error?: string | null;
  binding?: MessageBridgeBinding | null;
};

export type MessageBridgeExternalSession = {
  provider: string;
  channel: string;
  external_session_key: string;
  external_display_name?: string | null;
  updated_at?: string | null;
};

export type RuntimeHealthStatus = {
  ok: boolean;
  generated_at: string;
  api: {
    pid: number;
    data_dir: string;
    sqlite_path: string;
    ndjson_dir: string;
  };
  openclaw: {
    base_url: string;
    agent_id: string;
    model: string;
    message_channel: string;
    stream_mode: string;
    token_configured: boolean;
    proxy_configured: boolean;
    verify_ssl: boolean;
    timeout_seconds: number;
  };
  message_bridge: {
    provider: string;
    channel: string;
    status: {
      provider: string;
      channel: string;
      enabled: boolean;
      realtime_drive_character: boolean;
      websocket_status: string;
      reconnect_attempts: number;
      last_connected_at?: string | null;
      last_error?: string | null;
      updated_at?: string | null;
    };
    binding?: MessageBridgeBinding | null;
    local_session?: {
      id: string;
      title: string;
      title_source: string;
      openclaw_session_key: string;
      selected_model_path?: string | null;
      updated_at: string;
    } | null;
    latest_message?: {
      id: string;
      role: string;
      content_preview: string;
      openclaw_message_id?: string | null;
      source?: string | null;
      synced_from?: string | null;
      external_session_key?: string | null;
      created_at: string;
    } | null;
    warnings: string[];
  };
  tts: {
    enabled: boolean;
    base_url: string;
    timeout_seconds: number;
    poll_interval_seconds: number;
    max_poll_attempts: number;
    message_tts_by_status: Record<string, number>;
    jobs_by_status: Record<string, number>;
  };
  codex: {
    enabled: boolean;
    codex_bin: string;
    codex_version?: string | null;
    transport: string;
    active_sessions: number;
    allowed_workspaces: string[];
    last_error?: string | null;
  };
  database: {
    account_count: number;
    workspace_count: number;
    session_count: number;
    message_count: number;
    bridge_message_count: number;
    trace_event_count: number;
  };
  recent_errors: TraceEvent[];
};
