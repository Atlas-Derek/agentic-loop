/**
 * Lightweight session compaction.
 *
 * When a session has more than COMPACT_AFTER uncompacted messages, the older ones
 * are summarised by the model into a rolling summary, flagged `compacted` in the DB
 * (kept for debugging), and replaced in future prompts by that summary.
 * The most recent KEEP_RECENT (or slightly more) messages stay verbatim.
 */
import { generateText, type LanguageModel, type UIMessage } from 'ai';
import type { DB } from '../db/index';
import * as repo from '../db/repo';

/** Positive integer from an env var, or the fallback if unset/invalid (NaN would break selection). */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  console.warn(`[compaction] ignoring invalid ${name}=${raw}; using ${fallback}`);
  return fallback;
}

export function compactionSettings(): { after: number; keep: number } {
  return { after: envInt('COMPACT_AFTER', 12), keep: envInt('KEEP_RECENT', 4) };
}

/**
 * Pick which messages to fold into the summary. Returns [] if under threshold.
 * The kept tail always starts on a user message (some providers, e.g. Gemini,
 * reject histories that start with an assistant/tool turn), so we may keep a
 * few more than `keep`.
 */
export function selectMessagesToCompact<M extends { role: string }>(messages: M[], after: number, keep: number): M[] {
  if (messages.length <= after) return [];
  let cut = Math.max(0, messages.length - keep);
  while (cut > 0 && messages[cut].role !== 'user') cut -= 1;
  return messages.slice(0, cut);
}

/** Render UI messages as a plain-text transcript for the summariser. */
export function toTranscript(messages: Pick<UIMessage, 'role' | 'parts'>[]): string {
  return messages
    .map((m) => {
      const lines = m.parts.map((p) => {
        if (p.type === 'text') return p.text;
        if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') {
          const t = p as { type: string; toolName?: string; input?: unknown; output?: unknown; errorText?: string };
          const name = t.toolName ?? t.type.replace(/^tool-/, '');
          const result = t.errorText ? `ERROR ${t.errorText}` : JSON.stringify(t.output ?? null);
          return `[tool ${name}(${JSON.stringify(t.input ?? {})}) -> ${result}]`;
        }
        return '';
      });
      return `${m.role.toUpperCase()}: ${lines.filter(Boolean).join('\n')}`;
    })
    .join('\n\n');
}

const SUMMARY_PROMPT = `You maintain a running summary of a conversation between a user and a workflow planning agent.
Merge the previous summary (if any) with the new transcript excerpt into ONE updated summary.
Use exactly these markdown sections, be concise, and keep concrete details (names, numbers, decisions):

### User goal
### Decisions made
### Completed steps
### Open questions
### Current workflow state`;

/** Compact the session if it is over the threshold. Returns the new summary, or null if nothing was done. */
export async function maybeCompact(db: DB, sessionId: string, model: LanguageModel): Promise<repo.Summary | null> {
  const { after, keep } = compactionSettings();
  const active = repo.getMessages(db, sessionId);
  const toCompact = selectMessagesToCompact(active, after, keep);
  if (toCompact.length === 0) return null;

  const previous = repo.getLatestSummary(db, sessionId, 'compaction');
  const workflow = repo.getWorkflowState(db, sessionId);
  const taskLines = workflow.tasks.map((t) => `#${t.id} [${t.status}] ${t.title}`).join('\n') || '(none)';

  const { text } = await generateText({
    model,
    instructions: SUMMARY_PROMPT,
    prompt: [
      `## Previous summary\n${previous?.content ?? '(none)'}`,
      `## Live task list (authoritative)\nPhase: ${workflow.phase}\n${taskLines}`,
      `## Transcript excerpt to fold in\n${toTranscript(toCompact)}`,
    ].join('\n\n'),
  });

  const throughSeq = toCompact[toCompact.length - 1].seq;
  const summary = repo.addSummary(db, sessionId, 'compaction', text, throughSeq);
  repo.markCompacted(db, sessionId, throughSeq);
  return summary;
}
