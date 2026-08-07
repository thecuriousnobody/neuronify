// Label helpers for the app surfaces. The implementation lives in the engine —
// it composes workflow titles from the same keys and may not import from here —
// so this is the app-side door onto one shared definition.

// Imported from the module, NOT the engine barrel: the desk pages are client
// components, and the barrel would pull the repository and workflow service into
// their bundle for the sake of two pure string functions.
export { prettyFormKey, prettyKey } from '@/engine/intake/labels';
