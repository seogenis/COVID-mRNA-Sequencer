// Injected by Vite `define` (see vite.config.ts). True only in the single-file
// artifact build, where the sandbox CSP blocks direct calls to api.anthropic.com.
declare const __ATLAS_HOSTED__: boolean

export const HOSTED: boolean = typeof __ATLAS_HOSTED__ !== 'undefined' ? __ATLAS_HOSTED__ : false
