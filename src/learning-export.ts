/**
 * Learning materials export for the Buddy English teacher.
 *
 * Builds a simple dialog transcript and a vocabulary (word) list from the
 * live conversation, then triggers a one-click .txt download.
 */

import type { TranscriptMessage } from "agents/voice/react";

export interface LearningMaterials {
  dialog: { role: string; text: string }[];
  words: string[];
}

/**
 * Extract learning materials from the in-session transcript.
 *
 * - dialog: every non-empty user/assistant line, in order.
 * - words: unique, lowercased English words spoken by Buddy (the teacher),
 *   sorted alphabetically. This gives a basic word list; it can later be
 *   upgraded to an LLM-curated list.
 */
export function buildLearningMaterials(
  transcript: TranscriptMessage[]
): LearningMaterials {
  const dialog = transcript
    .filter((m) => m.text && m.text.trim().length > 0)
    .map((m) => ({ role: m.role, text: m.text }));

  const wordSet = new Set<string>();
  for (const m of transcript) {
    if (m.role !== "assistant" || !m.text) continue;
    const words = m.text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && /^[a-z]+$/.test(w));
    for (const w of words) wordSet.add(w);
  }

  return { dialog, words: Array.from(wordSet).sort() };
}

export function formatLearningMaterials(
  materials: LearningMaterials,
  sessionId: string
): string {
  const lines: string[] = [];
  lines.push("Buddy 英语学习资料");
  lines.push(`会话 ID: ${sessionId}`);
  lines.push(`导出时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");
  lines.push("======== 对话记录 ========");
  if (materials.dialog.length === 0) {
    lines.push("(暂无对话)");
  } else {
    for (const m of materials.dialog) {
      const who = m.role === "user" ? "你" : "Buddy";
      lines.push(`${who}: ${m.text}`);
    }
  }
  lines.push("");
  lines.push("======== 单词表 ========");
  if (materials.words.length === 0) {
    lines.push("(暂无单词)");
  } else {
    materials.words.forEach((w, i) => {
      lines.push(`${i + 1}. ${w}`);
    });
  }
  lines.push("");
  lines.push("—— 继续和 Buddy 一起学英语吧！");
  return lines.join("\n");
}

export function downloadLearningMaterials(
  transcript: TranscriptMessage[],
  sessionId: string
): void {
  const materials = buildLearningMaterials(transcript);
  const text = formatLearningMaterials(materials, sessionId);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `buddy-learning-${sessionId.slice(0, 8)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
