// Label helpers for the app surfaces. The implementation lives in the engine —
// it composes workflow titles from the same keys and may not import from here —
// so this is the app-side door onto one shared definition.

export { prettyFormKey, prettyKey } from '@/engine';
