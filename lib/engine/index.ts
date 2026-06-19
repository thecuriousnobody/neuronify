// The composition root: assemble a production EngineEnv from the app-side
// adapters. API routes call `engineEnv()` and hand it to the engine's service
// functions (submitForm, recordDecision, ...).

import type { EngineEnv } from '@/engine';
import { NeonRepository } from './repo';
import { aiLLM, outboxNotifier, systemClock, uuidIds } from './adapters';

let _env: EngineEnv | null = null;

export function engineEnv(): EngineEnv {
  if (!_env) {
    _env = {
      clock: systemClock,
      ids: uuidIds,
      repo: new NeonRepository(),
      notifier: outboxNotifier,
      llm: aiLLM,
    };
  }
  return _env;
}
