import {
  Agent,
  routeAgentRequest,
  type Connection,
  type WSMessage
} from "agents";
import {
  withVoice,
  type VoiceTurnContext,
  type Transcriber
} from "agents/voice";
import { streamText, tool, isStepCount } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
  createVoiceTranscriber
} from "./stt-providers";
import { BilingualTTS } from "./tts-providers";

const VoiceAgent = withVoice(Agent);

// System prompt is now provided by the getSystemPrompt() method on MyVoiceAgent.
// It returns a kid-friendly "Buddy" English-teacher persona and supports a
// Chinese explanation mode (lang === "zh") for when the child doesn't understand.

/**
 * Read the language mode ("en" | "zh") from a connection's query string.
 * The client sends `?lang=zh` when the child switches to Chinese explanation
 * mode (the call is restarted on toggle so the new mode takes effect).
 */
function getLangFromConnection(connection: Connection): "en" | "zh" {
  try {
    const url = new URL(connection.uri ?? "http://localhost");
    return url.searchParams.get("lang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export class MyVoiceAgent extends VoiceAgent<Env> {
  // English -> Deepgram Aura, Chinese -> MyShell MeloTTS. Both run on the
  // Workers AI binding (zero external keys, zero egress). See ./tts-providers.
  tts = new BilingualTTS(this.env.AI);

  createTranscriber(connection: Connection): Transcriber {
    return createVoiceTranscriber(connection, this.env);
  }

  // --- Single-speaker enforcement ---
  //
  // Only one connection can be the active speaker at a time. This prevents
  // two browser tabs from capturing audio simultaneously. Other connections
  // can still observe transcripts and send text messages.

  #activeSpeakerId: string | null = null;

  beforeCallStart(connection: Connection): boolean {
    if (this.#activeSpeakerId && this.#activeSpeakerId !== connection.id) {
      connection.send(
        JSON.stringify({
          type: "speaker_conflict",
          message:
            "Another session is currently the active speaker. You can kick them to take over."
        })
      );
      return false;
    }
    this.#activeSpeakerId = connection.id;
    return true;
  }

  onCallEnd(connection: Connection) {
    if (this.#activeSpeakerId === connection.id) {
      this.#activeSpeakerId = null;
    }
  }

  onClose(connection: Connection) {
    if (this.#activeSpeakerId === connection.id) {
      this.#activeSpeakerId = null;
    }
  }

  onMessage(connection: Connection, message: WSMessage) {
    // Voice protocol messages are intercepted automatically by the mixin.
    // This handler only receives non-voice messages.
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === "kick_speaker") {
          this.#handleKick(connection);
          return;
        }
      } catch {
        // not JSON
      }
    }
  }

  #handleKick(requester: Connection) {
    if (!this.#activeSpeakerId) {
      // No active speaker — nothing to kick
      return;
    }

    const activeConn = [...this.getConnections()].find(
      (c) => c.id === this.#activeSpeakerId
    );

    if (activeConn) {
      // Notify the kicked connection
      activeConn.send(
        JSON.stringify({
          type: "kicked",
          message: "Another session has taken over as the active speaker."
        })
      );
      // Force end their call — cleans up server-side state and sends idle
      this.forceEndCall(activeConn);
    }

    this.#activeSpeakerId = null;

    // Notify the requester they can now start
    requester.send(
      JSON.stringify({
        type: "speaker_available",
        message: "Previous speaker has been disconnected. You can start a call."
      })
    );
  }

  // --- System prompt (Buddy persona) ---

  /**
   * Returns the system prompt for the voice agent.
   *
   * Default ("en"): Buddy, a patient and friendly English teacher for
   * Chinese children aged 7-8. Hard constraints live in the prompt itself:
   *   - max 8 words per sentence
   *   - 1-2 sentences, then one easy follow-up question
   *   - encouragement-first, gentle correction
   *   - topics limited to colors / animals / food / family / numbers / daily activities
   *   - warm, positive tone
   *
   * "zh": the child switched to Chinese to ask for an explanation. Buddy
   * replies in simple, warm Chinese and may teach a word or two.
   *
   * NOTE: Chinese replies are now spoken aloud via MyShell MeloTTS
   * (`@cf/myshell-ai/melotts`, lang:"zh") — a Workers AI model, so no extra
   * key is required. English replies use Deepgram Aura. See ./tts-providers.
   */
  getSystemPrompt(lang: "en" | "zh" = "en"): string {
    if (lang === "zh") {
      return `你是 Buddy，陪伴中国小朋友学英语的 AI 老师。
现在请用中文，用非常简单、温暖的话，向孩子解释刚才那句英语的意思，或者回答孩子的问题。
规则：
- 每句话尽量短，容易听懂。
- 语气要鼓励、温柔、有耐心。
- 可以顺带教一两个简单的英语单词，并写出中文意思。
- 不要用难词或长句子。`;
    }

    return `You are Buddy, a happy English teacher for Chinese kids aged 7 to 8.
Always follow these rules:
- Speak ONLY in very simple English.
- Each sentence must be 8 words or fewer.
- Reply with 1 or 2 sentences, then ask one easy question.
- Only talk about: colors, animals, food, family, numbers, daily activities.
- Be encouraging. Praise the child often.
- If the child makes a mistake, gently and kindly correct it.
- Keep your tone warm, friendly, and fun.
- Never use hard or long words.`;
  }

  /**
   * Called by the voice pipeline just before each sentence is synthesized.
   * We use it to tell the bilingual TTS which language to speak: the
   * greeting always stays English, but every reply follows the connection's
   * `lang` query param (en = English lesson, zh = Chinese explanation).
   */
  beforeSynthesize(
    text: string,
    connection: Connection
  ): string | null | Promise<string | null> {
    (this.tts as BilingualTTS).setLang(getLangFromConnection(connection));
    return text;
  }

  // --- Voice agent logic ---

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const workersAi = createWorkersAI({ binding: this.env.AI });

    const url = new URL(context.connection.uri ?? "http://localhost");
    const llm = url.searchParams.get("llm");
    const lang = url.searchParams.get("lang") === "zh" ? "zh" : "en";
    const llmModel =
      llm === "kimi"
        ? "@cf/moonshotai/kimi-k2.7-code"
        : llm === "gpt-oss-20b"
          ? "@cf/openai/gpt-oss-20b"
          : "@cf/zai-org/glm-4.7-flash";

    const result = streamText({
      model: workersAi(llmModel as Parameters<typeof workersAi>[0], {
        sessionAffinity: this.sessionAffinity
      }),
      instructions: this.getSystemPrompt(lang),
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content
        })),
        { role: "user" as const, content: transcript }
      ],
      tools: {
        get_current_time: tool({
          description:
            "Get the current date and time. Use when the user asks what time it is.",
          inputSchema: z.object({}),
          execute: async () => {
            const now = new Date();
            return {
              time: now.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short"
              }),
              date: now.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
              })
            };
          }
        }),

        set_reminder: tool({
          description:
            "Set a reminder that will be spoken aloud after a delay.",
          inputSchema: z.object({
            message: z
              .string()
              .describe("The reminder message to speak to the user"),
            delay_seconds: z
              .number()
              .describe("How many seconds from now to trigger the reminder")
          }),
          execute: async ({
            message,
            delay_seconds
          }: {
            message: string;
            delay_seconds: number;
          }) => {
            await this.schedule(delay_seconds, "speakReminder", { message });
            const minutes = Math.round(delay_seconds / 60);
            const timeLabel =
              minutes >= 1
                ? `${minutes} minute${minutes > 1 ? "s" : ""}`
                : `${delay_seconds} seconds`;
            return { confirmed: true, message, delay: timeLabel };
          }
        }),

        get_weather: tool({
          description:
            "Get the current weather for a location. Use when the user asks about the weather.",
          inputSchema: z.object({
            location: z
              .string()
              .describe("The city or location to check weather for")
          }),
          execute: async ({ location }: { location: string }) => {
            const conditions = [
              "sunny",
              "partly cloudy",
              "overcast",
              "light rain"
            ];
            const condition =
              conditions[Math.floor(Math.random() * conditions.length)];
            const temp = Math.floor(55 + Math.random() * 35);
            return {
              location,
              temperature: `${temp}°F`,
              condition,
              note: "Mock data — connect a weather MCP server for real forecasts."
            };
          }
        })
      },
      stopWhen: isStepCount(3),
      abortSignal: context.signal
    });

    return result.stream;
  }

  async onCallStart(connection: Connection) {
    const messageCount =
      this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM cf_voice_messages
    `[0]?.count ?? 0;

    const lang = getLangFromConnection(connection);
    const greeting =
      lang === "zh"
        ? "你好！我是巴迪，你的英语老师。我们一起来学英语吧！"
        : messageCount > 0
          ? "Welcome back! I am Buddy. Let's learn English again!"
          : "Hi! I am Buddy, your English teacher! Let's have fun with English!";

    // The TTS language for the greeting is chosen by beforeSynthesize() from
    // the connection's lang param, so a Chinese greeting is spoken by MeloTTS
    // and an English greeting by Deepgram Aura — never mismatched.
    await this.speak(connection, greeting);
  }

  async speakReminder(payload: { message: string }) {
    await this.speakAll(`Reminder: ${payload.message}`);
  }
}

// --- SFU integration ---
import { handleSFURequest } from "./sfu";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // SFU routes (proxied API calls + WebSocket endpoints)
    if (url.pathname.startsWith("/sfu/")) {
      const appId = (env as unknown as Record<string, string>)
        .CLOUDFLARE_REALTIME_SFU_APP_ID;
      const apiToken = (env as unknown as Record<string, string>)
        .CLOUDFLARE_REALTIME_SFU_API_TOKEN;

      if (!appId || !apiToken) {
        return Response.json(
          { error: "SFU credentials not configured" },
          { status: 500 }
        );
      }

      const sfuResponse = await handleSFURequest(request, {
        appId,
        apiToken,
        agentNamespace: env.MyVoiceAgent as unknown as DurableObjectNamespace
      });
      if (sfuResponse) return sfuResponse;
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
