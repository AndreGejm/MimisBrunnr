export interface ServiceError<Code extends string = string> {
  code: Code;
  message: string;
  details?: Record<string, unknown>;
}

export type ServiceResult<TData, Code extends string = string> =
  | {
      ok: true;
      data: TData;
      warnings?: string[];
    }
  | {
      ok: false;
      error: ServiceError<Code>;
      warnings?: string[];
    };
