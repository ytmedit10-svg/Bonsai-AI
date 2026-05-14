export type ApiErrorType =
  | "app"
  | "network"
  | "provider"
  | "validation";

export type ApiErrorPayload = {
  error: {
    action?: string;
    code: string;
    message: string;
    providerStatus?: number;
    reason?: string;
    retryable: boolean;
    title?: string;
    type: ApiErrorType;
  };
  message: string;
};

type BuildApiErrorInput = {
  action?: string;
  code: string;
  message: string;
  providerStatus?: number;
  reason?: string;
  retryable?: boolean;
  title?: string;
  type: ApiErrorType;
};

const fallbackMessageByType: Record<ApiErrorType, string> = {
  app: "The app hit an internal error.",
  network: "The network request failed.",
  provider: "The model provider returned an error.",
  validation: "The request was invalid."
};

export const buildApiError = ({
  action,
  code,
  message,
  providerStatus,
  reason,
  retryable = false,
  title,
  type
}: BuildApiErrorInput): ApiErrorPayload => {
  const safeMessage = message.trim() || fallbackMessageByType[type];

  return {
    error: {
      action,
      code,
      message: safeMessage,
      providerStatus,
      reason,
      retryable,
      title,
      type
    },
    message: safeMessage
  };
};

type ProviderError = {
  message: string;
  statusCode: number;
};

const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const unwrapProviderMessage = (message: string): string => {
  const parsed = tryParseJson(message.trim());

  if (!isRecord(parsed)) {
    return message;
  }

  const error = parsed.error;

  if (typeof error === "string") {
    return unwrapProviderMessage(error);
  }

  if (isRecord(error) && typeof error.message === "string") {
    return unwrapProviderMessage(error.message);
  }

  if (typeof parsed.message === "string") {
    return unwrapProviderMessage(parsed.message);
  }

  return message;
};

export const getProviderError = (error: unknown): ProviderError | null => {
  if (!isRecord(error)) {
    return null;
  }

  const maybeStatus = error.status;
  const maybeMessage = error.message;

  if (typeof maybeStatus !== "number" || typeof maybeMessage !== "string") {
    return null;
  }

  return {
    message: unwrapProviderMessage(maybeMessage),
    statusCode: maybeStatus
  };
};

export const getProviderStatusCode = (error: unknown) =>
  getProviderError(error)?.statusCode ?? null;

const getErrorText = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" && error.trim() ? error : fallback;
};

export const buildProviderApiError = (
  error: unknown,
  fallback: string
): ApiErrorPayload => {
  const providerError = getProviderError(error);
  const providerStatus = providerError?.statusCode;
  const rawMessage = providerError?.message ?? getErrorText(error, fallback);
  const loweredMessage = rawMessage.toLowerCase();
  const isOllama =
    loweredMessage.includes("ollama") ||
    error instanceof Error && error.name.toLowerCase().includes("ollama");

  if (
    isOllama &&
    (loweredMessage.includes("econnrefused") ||
      loweredMessage.includes("could not reach") ||
      loweredMessage.includes("start ollama") ||
      providerStatus === 502 ||
      providerStatus === 504)
  ) {
    return buildApiError({
      action: "Start Ollama",
      code: `AI_PROVIDER_${providerStatus ?? "OLLAMA_OFFLINE"}`,
      message: "Open the Ollama app, make sure it is running, then try again.",
      providerStatus,
      reason: "ollama_offline",
      retryable: true,
      title: "Ollama is not running",
      type: "provider"
    });
  }

  if (
    isOllama &&
    (loweredMessage.includes("not installed") ||
      loweredMessage.includes("pull") ||
      loweredMessage.includes("model") && loweredMessage.includes("not found"))
  ) {
    return buildApiError({
      action: "Install model",
      code: `AI_PROVIDER_${providerStatus ?? "OLLAMA_MODEL_MISSING"}`,
      message: "Install the selected Gemma 4 model in Ollama, then try again.",
      providerStatus,
      reason: "ollama_model_missing",
      retryable: false,
      title: "Gemma 4 model missing",
      type: "provider"
    });
  }

  if (isOllama && providerStatus) {
    return buildApiError({
      action: providerStatus >= 500 ? "Retry" : "Review local model",
      code: `OLLAMA_PROVIDER_${providerStatus}`,
      message:
        providerStatus >= 500
          ? "Local Gemma 4 could not complete the request. Make sure Ollama is healthy, then retry."
          : "Ollama could not accept this local Gemma 4 request. Check the selected local model and retry.",
      providerStatus,
      reason: providerStatus >= 500 ? "ollama_provider_unavailable" : "ollama_request_rejected",
      retryable: providerStatus >= 500,
      title: providerStatus >= 500 ? "Local Gemma 4 is unavailable" : "Local Gemma 4 request failed",
      type: providerStatus >= 500 ? "provider" : "validation"
    });
  }

  if (providerStatus === 429) {
    return buildApiError({
      action: "Retry",
      code: "AI_PROVIDER_429",
      message: "Gemma 4 is temporarily busy. This hosted demo shares API quota, so retry in a moment.",
      providerStatus,
      reason: "quota_or_rate_limit",
      retryable: true,
      title: "Hosted Gemma 4 quota is full",
      type: "provider"
    });
  }

  if (providerStatus === 503 || providerStatus === 500) {
    return buildApiError({
      action: "Retry",
      code: `AI_PROVIDER_${providerStatus}`,
      message: "Gemma 4 is under high demand. Try again in a few seconds.",
      providerStatus,
      reason: "provider_overloaded",
      retryable: true,
      title: "Gemma 4 is busy",
      type: "provider"
    });
  }

  if (providerStatus === 404) {
    return buildApiError({
      action: "Choose model",
      code: "AI_PROVIDER_404",
      message: "That Gemma 4 model is not available from the hosted API. Pick another model and retry.",
      providerStatus,
      reason: "model_unavailable",
      retryable: false,
      title: "Hosted model unavailable",
      type: "provider"
    });
  }

  if (
    loweredMessage.includes("thinking") ||
    loweredMessage.includes("thinkingbudget") ||
    loweredMessage.includes("thinking_config")
  ) {
    return buildApiError({
      action: "Use Fast mode",
      code: `AI_PROVIDER_${providerStatus ?? "THINKING_UNSUPPORTED"}`,
      message: "Thinking mode is not supported for this model/provider combination.",
      providerStatus,
      reason: "thinking_unsupported",
      retryable: false,
      title: "Thinking mode unavailable",
      type: "validation"
    });
  }

  if (
    loweredMessage.includes("token") ||
    loweredMessage.includes("context") ||
    loweredMessage.includes("too large") ||
    loweredMessage.includes("input size")
  ) {
    return buildApiError({
      action: "Shorten chat",
      code: `AI_PROVIDER_${providerStatus ?? "CONTEXT_TOO_LARGE"}`,
      message: "This chat is too large for the selected model. Start a new branch or remove attachments, then retry.",
      providerStatus,
      reason: "context_too_large",
      retryable: false,
      title: "Chat is too large",
      type: "validation"
    });
  }

  if (providerStatus === 400) {
    return buildApiError({
      action: "Adjust request",
      code: "AI_PROVIDER_400",
      message: "This model could not accept that request. Adjust the prompt or model and try again.",
      providerStatus,
      reason: "provider_rejected_request",
      retryable: false,
      title: "Request needs a small fix",
      type: "validation"
    });
  }

  if (providerStatus) {
    return buildApiError({
      action: providerStatus >= 500 ? "Retry" : "Review request",
      code: `AI_PROVIDER_${providerStatus}`,
      message:
        providerStatus >= 500
          ? "The model provider is temporarily unavailable. Retry in a moment."
          : "The model provider could not complete this request.",
      providerStatus,
      reason: providerStatus >= 500 ? "provider_unavailable" : "provider_rejected_request",
      retryable: providerStatus >= 500,
      title: providerStatus >= 500 ? "Model provider unavailable" : "Model provider error",
      type: providerStatus >= 500 ? "provider" : "validation"
    });
  }

  return buildApiError({
    action: "Retry",
    code: "AI_PROVIDER_FAILED",
    message: fallback,
    reason: "provider_failed",
    retryable: true,
    title: "Model provider error",
    type: "provider"
  });
};
