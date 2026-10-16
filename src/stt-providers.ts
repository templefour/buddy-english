import type { Transcriber } from "agents/voice";
import type { Connection } from "agents";
import type { SttProvider } from "./stt-providers/types";
import { createWorkersAITranscriber } from "./stt-providers/workers-ai";

export function createVoiceTranscriber(
  connection: Connection,
  env: Env
): Transcriber {
  const url = new URL(connection.uri ?? "http://localhost");
  const provider = getSttProvider(connection);
  return createWorkersAITranscriber(env, provider, url);
}

function getConnectionUrl(connection: Connection): URL {
  return new URL(connection.uri ?? "http://localhost");
}

function getSttProvider(connection: Connection): SttProvider {
  const url = getConnectionUrl(connection);
  const provider = url.searchParams.get("stt");

  if (provider === "workers-ai-nova-3") {
    return "workers-ai-nova-3";
  }

  if (provider === "workers-ai-flux") {
    return "workers-ai-flux";
  }

  // Preserve the old query parameter so existing links keep working.
  if (url.searchParams.get("model") === "nova-3") {
    return "workers-ai-nova-3";
  }

  return "workers-ai-flux";
}
