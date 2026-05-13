export type ApiErrorType =
  | "app"
  | "network"
  | "provider"
  | "validation";

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    type: ApiErrorType;
  };
  message: string;
};

type BuildApiErrorInput = {
  code: string;
  message: string;
  retryable?: boolean;
  type: ApiErrorType;
};

const fallbackMessageByType: Record<ApiErrorType, string> = {
  app: "The app hit an internal error.",
  network: "The network request failed.",
  provider: "The model provider returned an error.",
  validation: "The request was invalid."
};

export const buildApiError = ({
  code,
  message,
  retryable = false,
  type
}: BuildApiErrorInput): ApiErrorPayload => {
  const safeMessage = message.trim() || fallbackMessageByType[type];

  return {
    error: {
      code,
      message: safeMessage,
      retryable,
      type
    },
    message: safeMessage
  };
};
