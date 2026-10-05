/**
 * 稳定错误码定义。所有对外（HTTP/CLI）错误都使用这些 code，
 * 调用方可以依赖 code 做分支处理，message 仅用于人类阅读。
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'PLAYER_NOT_FOUND'
  | 'SELF_MATCH_FORBIDDEN'
  | 'DUPLICATE_GAME_SEQ'
  | 'RULE_VERSION_NOT_FOUND'
  | 'DATA_VERSION_NOT_FOUND'
  | 'BASE_VERSION_EMPTY'
  | 'GAME_SEQ_NOT_FOUND'
  | 'LIMIT_EXCEEDED'
  | 'BAD_RESULT'
  | 'BAD_JSON'
  | 'NOT_FOUND';

export class EloError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'EloError';
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown): EloError {
  return new EloError('VALIDATION_ERROR', message, details);
}

export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
    case 'BAD_RESULT':
    case 'BAD_JSON':
    case 'SELF_MATCH_FORBIDDEN':
    case 'DUPLICATE_GAME_SEQ':
    case 'BASE_VERSION_EMPTY':
    case 'LIMIT_EXCEEDED':
      return 400;
    case 'PLAYER_NOT_FOUND':
    case 'RULE_VERSION_NOT_FOUND':
    case 'DATA_VERSION_NOT_FOUND':
    case 'GAME_SEQ_NOT_FOUND':
      return 404;
    case 'NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}
