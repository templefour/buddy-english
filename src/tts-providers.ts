/**
 * Bilingual text-to-speech provider for Buddy.
 *
 * English replies are spoken with Deepgram Aura (via Workers AI) — the same
 * high-quality English voice the original example used. Chinese replies are
 * spoken with MyShell MeloTTS (`@cf/myshell-ai/melotts`), a multilingual
 * Workers AI model that natively supports `lang: "zh"`.
 *
 * Both models run on the `env.AI` binding, so the whole thing works with
 * **zero external API keys and zero outbound network egress** — matching the
 * example's "runs out of the box" philosophy.
 *
 * The language for the *next* `synthesize()` call is selected with
 * `setLang()`, which the agent calls from `beforeSynthesize()` (per sentence)
 * and from `onCallStart()` (for the greeting). Because this example enforces a
 * single active speaker, only one connection synthesizes audio at a time, so a
 * single mutable language flag is safe.
 */

import type { TTSProvider } from "agents/voice";

/** Loose type for the Workers AI binding — avoids a hard dependency on @cloudflare/workers-types. */
interface AiLike {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}

export interface BilingualTTSOptions {
  /** English TTS model (Workers AI). @default "@cf/deepgram/aura-1" */
  enModel?: string;
  /** Multilingual TTS model used for Chinese (Workers AI, supports lang:"zh"). @default "@cf/myshell-ai/melotts" */
  zhModel?: string;
}

export class BilingualTTS implements TTSProvider {
  #ai: AiLike;
  #enModel: string;
  #zhModel: string;
  #lang: "en" | "zh" = "en";

  constructor(ai: AiLike, options?: BilingualTTSOptions) {
    this.#ai = ai;
    this.#enModel = options?.enModel ?? "@cf/deepgram/aura-1";
    this.#zhModel = options?.zhModel ?? "@cf/myshell-ai/melotts";
  }

  /** Select the language for the upcoming synthesize() calls. */
  setLang(lang: "en" | "zh"): void {
    this.#lang = lang;
  }

  async synthesize(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    if (this.#lang === "zh") {
      return this.#synthesizeMelotts(text, signal);
    }
    return this.#synthesizeDeepgram(text, signal);
  }

  async #synthesizeDeepgram(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    try {
      const response = (await this.#ai.run(
        this.#enModel,
        { text, speaker: "asteria" },
        { returnRawResponse: true, ...(signal ? { signal } : {}) }
      )) as Response;

      if (!response.ok) {
        console.error(
          `[BilingualTTS] Deepgram TTS request failed: ${response.status}`
        );
        return null;
      }
      return await response.arrayBuffer();
    } catch (err) {
      console.error("[BilingualTTS] Deepgram TTS error", err);
      return null;
    }
  }

  async #synthesizeMelotts(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    try {
      const response = (await this.#ai.run(
        this.#zhModel,
        { prompt: text, lang: "zh" },
        { returnRawResponse: true, ...(signal ? { signal } : {}) }
      )) as Response;

      if (!response.ok) {
        console.error(
          `[BilingualTTS] MeloTTS request failed: ${response.status}`
        );
        return null;
      }

      // MeloTTS normally returns raw MP3 audio when returnRawResponse is set,
      // mirroring Deepgram Aura. As a safety net, some Workers AI models fall
      // back to a JSON envelope with a base64 `audio` field — decode that too.
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = (await response.json()) as { audio?: string };
        if (json.audio) {
          const binary = atob(json.audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes.buffer;
        }
        return null;
      }

      return await response.arrayBuffer();
    } catch (err) {
      console.error("[BilingualTTS] MeloTTS error", err);
      return null;
    }
  }
}
