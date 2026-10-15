import { EXIT_USAGE } from "./verdict.js";

export type TmErrorKind = "usage" | "not_found" | "integrity" | "internal";

export class TmError extends Error {
  readonly kind: TmErrorKind;
  constructor(kind: TmErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "TmError";
  }
  get exitCode(): number {
    return this.kind === "usage" ? EXIT_USAGE : 4;
  }
}
