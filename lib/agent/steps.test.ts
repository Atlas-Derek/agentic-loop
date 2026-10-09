import { describe, expect, it } from 'vitest';
import { limitFinalStep, STEP_LIMIT_NOTE } from './steps';

describe('limitFinalStep', () => {
  const prepare = limitFinalStep(3, 'BASE');

  it('leaves earlier steps untouched', () => {
    expect(prepare({ stepNumber: 0 })).toBeUndefined();
    expect(prepare({ stepNumber: 1 })).toBeUndefined();
  });

  it('disables tools and asks for a progress reply on the last step (0-based)', () => {
    expect(prepare({ stepNumber: 2 })).toEqual({ toolChoice: 'none', instructions: `BASE\n\n${STEP_LIMIT_NOTE}` });
  });
});
