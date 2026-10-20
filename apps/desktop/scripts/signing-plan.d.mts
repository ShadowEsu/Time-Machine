export declare const localEntitlements: string;
export declare const releaseEntitlements: string;

export type SigningConfig =
  | { mode: "local" }
  | { mode: "developer-id"; identity: string; notaryProfile: string | undefined };

export type Signer =
  | { mode: "local"; fingerprint: string; keychain: string }
  | { mode: "developer-id"; fingerprint: string };

export type FinishStep =
  | { remove: string }
  | { run: [string, string[]] }
  | { notarize: [string, string[]]; profile: string };

export declare function signingConfig(env: Record<string, string | undefined>, options?: { release?: boolean }): SigningConfig;
export declare function pickIdentity(output: string, requested: string): { name: string; fingerprint: string };
export declare function codesignArgs(signer: Signer, path: string, executable: boolean): string[];
export declare function finishSteps(options: { app: string; zip: string; notaryProfile: string | undefined }): FinishStep[];
export declare function checkNotary(stdout: string, exitStatus: number | null | undefined, profile: string): string;
