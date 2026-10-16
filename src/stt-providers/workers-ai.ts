import {
  WorkersAIFluxSTT,
  WorkersAINova3STT,
  type Transcriber
} from "agents/voice";
import { getOptionalProviderKeyterms } from "./utils";

export function createWorkersAITranscriber(
  env: Env,
  model: string,
  url: URL
): Transcriber {
  const keyterms = getOptionalProviderKeyterms(url);

  if (model === "workers-ai-nova-3") {
    return new WorkersAINova3STT(env.AI, { keyterms, utteranceEndMs: 1200 });
  }

  // Lower the end-of-turn timeout so that when the child releases the
  // push-to-talk button (mic muted → silence), the turn finalizes within
  // ~1.5s instead of the 5s default — feels responsive for push-to-talk.
  return new WorkersAIFluxSTT(env.AI, { keyterms, eotTimeoutMs: 1500 });
}
