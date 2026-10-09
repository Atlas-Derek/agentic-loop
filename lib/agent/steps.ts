/**
 * Step budget handling for the agent loop.
 *
 * `stopWhen: stepCountIs(n)` ends the loop silently, which can leave a turn ending on a bare tool
 * call with no reply. On the last allowed step we disable tools so the model must write a reply
 * that reports progress and tells the user how to continue.
 */
import type { ToolChoice, ToolSet } from 'ai';

export const STEP_LIMIT_NOTE = `## Step limit reached
This is your last step for this turn and tools are disabled. In your reply, briefly say what you completed,
what is still pending, and ask the user to reply "continue" to keep going. Do not claim unfinished work is done.`;

/** prepareStep callback: no-op until the final step (stepNumber is 0-based), then text only. */
export function limitFinalStep(maxSteps: number, instructions: string) {
  return ({ stepNumber }: { stepNumber: number }): { toolChoice: ToolChoice<ToolSet>; instructions: string } | undefined =>
    stepNumber >= maxSteps - 1 ? { toolChoice: 'none', instructions: `${instructions}\n\n${STEP_LIMIT_NOTE}` } : undefined;
}
