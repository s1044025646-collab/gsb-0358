export type ErrorCode =
  | "E_VALIDATION"
  | "E_PLAYER_NOT_FOUND"
  | "E_DUP_MATCH"
  | "E_DUP_SEQ"
  | "E_SELF_MATCH"
  | "E_BAD_RESULT"
  | "E_RULE_NOT_FOUND"
  | "E_VERSION_NOT_FOUND"
  | "E_MATCH_NOT_FOUND"
  | "E_LIMIT"
  | "E_INTERNAL";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400) {
    super(message);
  }
}
