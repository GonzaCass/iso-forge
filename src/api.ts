export type Build = { uuid: string; title: string; build: string; arch: string; created: number };
export type Choice = { code: string; name: string };
export type Selection = { id: string; lang: string; edition: string; directory: string; updates: boolean };
export type Result = { iso: string; sha256: string; bytes: number; edition: string; lang: string; catalogBuild: string;
  created: string; images: { name: string; type: string; version: { BUILD: string; SPBUILD: string } }[] };
export type State = { phase: string; message: string; progress?: number; logs: { time: string; message: string }[];
  downloadedBytes?: number; totalBytes?: number; file?: string; fileIndex?: number; fileCount?: number; folder?: string; error?: string; result?: Result };
export type Forge = {
  initialize: () => Promise<{ preferences: { directory: string }; history: Result[]; state: State; version: string }>,
  builds: (product: string) => Promise<Build[]>;
  languages: (id: string) => Promise<{ items: Choice[]; info: { ring: string } }>;
  editions: (id: string, lang: string) => Promise<Choice[]>;
  chooseDirectory: () => Promise<string | null>;
  start: (selection: Selection) => Promise<boolean>; pause: () => Promise<boolean>;
  openFolder: (folder: string) => Promise<void>; copy: (value: string) => Promise<void>;
  openLink: (name: string) => Promise<void>; onState: (callback: (state: State) => void) => () => void;
};
declare global { interface Window { forge?: Forge } }
export const forge = window.forge;
