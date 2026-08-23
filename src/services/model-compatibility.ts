import type { ReasoningPreference } from "@/types";

export type { ReasoningPreference } from "@/types";

export type ManualReasoningEffort = Exclude<ReasoningPreference, "auto">;

export interface OpenRouterReasoningCapabilities {
  supportedEfforts: ManualReasoningEffort[] | null;
  defaultEffort?: ManualReasoningEffort;
  defaultEnabled?: boolean;
  mandatory?: boolean;
}

export interface OpenRouterModelCapabilities {
  id: string;
  name: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  supportedParameters: string[];
  reasoning?: OpenRouterReasoningCapabilities;
}

const STORAGE_KEYS = {
  REASONING_PREFERENCE: "tama_reasoning_preference",
  AUTOMATIC_RECOVERY: "tama_automatic_model_recovery",
} as const;

const CAPABILITY_CACHE_TTL_MS = 15 * 60 * 1000;
const capabilityCache = new Map<
  string,
  { fetchedAt: number; capabilities: OpenRouterModelCapabilities }
>();

const REASONING_PREFERENCES: ReasoningPreference[] = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
];

const MANUAL_REASONING_EFFORTS: ManualReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
];

const ACTIVE_REASONING_EFFORTS: ManualReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "max",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReasoningPreference(value: string | null): value is ReasoningPreference {
  return value !== null && REASONING_PREFERENCES.includes(value as ReasoningPreference);
}

function isManualReasoningEffort(value: unknown): value is ManualReasoningEffort {
  return (
    typeof value === "string" &&
    MANUAL_REASONING_EFFORTS.includes(value as ManualReasoningEffort)
  );
}

export function getReasoningPreference(): ReasoningPreference {
  const stored = localStorage.getItem(STORAGE_KEYS.REASONING_PREFERENCE);
  return isReasoningPreference(stored) ? stored : "auto";
}

export function setReasoningPreference(preference: ReasoningPreference): void {
  localStorage.setItem(STORAGE_KEYS.REASONING_PREFERENCE, preference);
  window.dispatchEvent(new Event("tama-config-changed"));
}

export function isAutomaticModelRecoveryEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.AUTOMATIC_RECOVERY) !== "false";
}

export function setAutomaticModelRecoveryEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.AUTOMATIC_RECOVERY, String(enabled));
  window.dispatchEvent(new Event("tama-config-changed"));
}

export function clearModelCompatibilityPreferences(): void {
  localStorage.removeItem(STORAGE_KEYS.REASONING_PREFERENCE);
  localStorage.removeItem(STORAGE_KEYS.AUTOMATIC_RECOVERY);
  window.dispatchEvent(new Event("tama-config-changed"));
}

function parseReasoningCapabilities(value: unknown): OpenRouterReasoningCapabilities | undefined {
  if (!isRecord(value)) return undefined;

  const supportedEfforts = Array.isArray(value.supported_efforts)
    ? value.supported_efforts.filter(isManualReasoningEffort)
    : value.supported_efforts === null
      ? null
      : undefined;
  const defaultEffort = isManualReasoningEffort(value.default_effort)
    ? value.default_effort
    : undefined;

  return {
    supportedEfforts: supportedEfforts ?? null,
    defaultEffort,
    defaultEnabled:
      typeof value.default_enabled === "boolean" ? value.default_enabled : undefined,
    mandatory: typeof value.mandatory === "boolean" ? value.mandatory : undefined,
  };
}

function parseOpenRouterModelCapabilities(value: unknown): OpenRouterModelCapabilities {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("OpenRouter returned invalid model metadata");
  }

  const data = value.data;
  if (typeof data.id !== "string" || !data.id.trim()) {
    throw new Error("OpenRouter model metadata is missing an identifier");
  }

  const supportedParameters = Array.isArray(data.supported_parameters)
    ? data.supported_parameters.filter(
        (parameter): parameter is string => typeof parameter === "string" && parameter.length > 0
      )
    : [];
  const topProvider = isRecord(data.top_provider) ? data.top_provider : undefined;

  return {
    id: data.id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : data.id,
    contextLength:
      typeof data.context_length === "number" ? data.context_length : undefined,
    maxCompletionTokens:
      typeof topProvider?.max_completion_tokens === "number" &&
      topProvider.max_completion_tokens > 0
        ? topProvider.max_completion_tokens
        : undefined,
    supportedParameters,
    reasoning: parseReasoningCapabilities(data.reasoning),
  };
}

export async function getOpenRouterModelCapabilities(
  modelId: string,
  options?: { forceRefresh?: boolean }
): Promise<OpenRouterModelCapabilities> {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId || !normalizedModelId.includes("/")) {
    throw new Error("Enter a complete OpenRouter model ID such as author/model");
  }

  const cached = capabilityCache.get(normalizedModelId);
  if (
    !options?.forceRefresh &&
    cached &&
    Date.now() - cached.fetchedAt < CAPABILITY_CACHE_TTL_MS
  ) {
    return cached.capabilities;
  }

  const encodedModelId = normalizedModelId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const response = await fetch(`https://openrouter.ai/api/v1/model/${encodedModelId}`);
  if (!response.ok) {
    throw new Error(`OpenRouter model lookup failed (HTTP ${response.status})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new Error("OpenRouter returned invalid model metadata");
  }

  const capabilities = parseOpenRouterModelCapabilities(parsed);
  capabilityCache.set(normalizedModelId, { fetchedAt: Date.now(), capabilities });
  return capabilities;
}

export function supportsOpenRouterParameter(
  capabilities: OpenRouterModelCapabilities | undefined,
  parameter: string
): boolean {
  return capabilities?.supportedParameters.includes(parameter) ?? false;
}

export function getLowestSupportedReasoningEffort(
  capabilities: OpenRouterModelCapabilities | undefined
): ManualReasoningEffort {
  const supported = capabilities?.reasoning?.supportedEfforts;
  if (!supported || supported.length === 0) return "minimal";

  // A model that requires reasoning must never be assigned the otherwise-valid
  // `none` setting, even if a provider reports it alongside active efforts.
  for (const effort of ACTIVE_REASONING_EFFORTS) {
    if (supported.includes(effort)) return effort;
  }

  return capabilities?.reasoning?.defaultEffort ?? "minimal";
}
