export interface Io { cwd: string; env: NodeJS.ProcessEnv; stdout: (s: string) => void; stderr: (s: string) => void; isTTY: boolean }
export async function main(_argv: string[], _io: Io): Promise<number> {
  throw new Error("main is not implemented yet");
}
