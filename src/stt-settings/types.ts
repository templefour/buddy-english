export type SttProvider = "workers-ai-flux" | "workers-ai-nova-3";

export interface SttSettings {
  provider: SttProvider;
  keyterms: string;
}

export type SettingsUpdate = (patch: Partial<SttSettings>) => void;
