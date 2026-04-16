export class TransportValidationError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TransportValidationError";
  }

  toServiceError(): {
    code: "validation_failed";
    message: string;
    details?: Record<string, unknown>;
  } {
    return {
      code: "validation_failed",
      message: this.message,
      details: this.details
    };
  }
}

