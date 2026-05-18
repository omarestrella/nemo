export type NemoErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PLATFORM_COMMAND_FAILED"
  | "PLATFORM_COMMAND_TIMEOUT"
  | "PLATFORM_COMMAND_NOT_ALLOWED"
  | "INVALID_APP_NAME"
  | "PAIRING_EXCHANGE_FAILED"
  | "PAIRING_AUTHORIZATION_PENDING"
  | "PAIRING_CHALLENGE_NOT_FOUND"
  | "PAIRING_TRIGGER_FORBIDDEN"
  | "PAIRING_VERIFIER_INVALID"
  | "STATE_NOT_INITIALIZED"
  | "INTERNAL_ERROR";

export class NemoError extends Error {
  readonly code: NemoErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | null;

  constructor(
    code: NemoErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "NemoError";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

export function toNemoError(error: unknown): NemoError {
  if (error instanceof NemoError) {
    return error;
  }

  if (error instanceof Error) {
    return new NemoError("INTERNAL_ERROR", error.message, { status: 500, retryable: false });
  }

  return new NemoError("INTERNAL_ERROR", "Internal error", { status: 500, retryable: false });
}

export function errorBody(error: NemoError): object {
  const body: {
    error: {
      code: NemoErrorCode;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };
  } = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
  if (error.details) {
    body.error.details = error.details;
  }
  return body;
}
