export type ProviderErrorKind =
  | "context_length"
  | "auth"
  | "rate_limit"
  | "model_not_found"
  | "transport"
  | "server"
  | "timeout"
  | "unknown";

export interface ClassifiedProviderError {
  kind: ProviderErrorKind;
  retryable: boolean;
  operatorAction: string;
  message: string;
}

export interface ProviderRetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export function classifyProviderError(error: unknown): ClassifiedProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const status = readNumericStatus(error, message);

  if (
    /\b(context|prompt)\s*(length|window|limit)\b/i.test(message) ||
    /\b(token|tokens)\s*(limit|length|exceeded|too large)\b/i.test(message) ||
    /maximum context|too many tokens|context length exceeded/i.test(message)
  ) {
    return {
      kind: "context_length",
      retryable: false,
      operatorAction:
        "Reduce prompt context. If memory context was included, lower memoryContext.maxTokens before retrying.",
      message
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|invalid api key|authentication|permission denied/.test(normalized)
  ) {
    return {
      kind: "auth",
      retryable: false,
      operatorAction: "Check the local provider credentials and actor/provider permissions.",
      message
    };
  }

  if (status === 429 || /rate limit|too many requests/.test(normalized)) {
    return {
      kind: "rate_limit",
      retryable: true,
      operatorAction: "Retry once after a short delay or reduce concurrent local-model calls.",
      message
    };
  }

  if (
    status === 404 ||
    /model.*not found|not found.*model|no such model|unknown model|pull the model/.test(normalized)
  ) {
    return {
      kind: "model_not_found",
      retryable: false,
      operatorAction: "Install or select the configured local model before retrying.",
      message
    };
  }

  if (
    /aborterror|timed?\s*out|timeout|signal timed out|deadline exceeded/.test(normalized)
  ) {
    return {
      kind: "timeout",
      retryable: true,
      operatorAction: "Retry once; if repeated, increase the provider timeout or reduce prompt size.",
      message
    };
  }

  if (
    /econnrefused|econnreset|enotfound|network|fetch failed|connection refused|socket hang up/.test(normalized)
  ) {
    return {
      kind: "transport",
      retryable: true,
      operatorAction: "Confirm the local provider is running and reachable.",
      message
    };
  }

  if (
    (status !== undefined && status >= 500 && status <= 599) ||
    /server error|internal server|bad gateway|service unavailable|gateway timeout/.test(normalized)
  ) {
    return {
      kind: "server",
      retryable: true,
      operatorAction: "Retry once; if repeated, inspect local provider logs.",
      message
    };
  }

  return {
    kind: "unknown",
    retryable: false,
    operatorAction: "Inspect the provider error and retry manually only after identifying the cause.",
    message
  };
}

export async function withBoundedProviderRetry<T>(
  operation: () => Promise<T>,
  options: ProviderRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 250;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyProviderError(error);
      if (!classified.retryable || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      if (retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }
}

function readNumericStatus(error: unknown, message: string): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isInteger(status)) {
      return status;
    }
  }

  const statusMatch = message.match(/\bstatus\s+(\d{3})\b/i) ?? message.match(/\b(\d{3})\b/);
  if (!statusMatch) {
    return undefined;
  }

  const status = Number.parseInt(statusMatch[1], 10);
  return Number.isInteger(status) ? status : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
