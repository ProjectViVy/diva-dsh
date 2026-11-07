/**
 * Type surface for the shared component transport, for the one TypeScript
 * consumer (`dsh-continual-harness`). The runtime module stays plain
 * JavaScript; this declaration names only the two entry points the harness
 * uses, so the harness keeps `allowJs` off and never pulls the shared `.mjs`
 * sources into its own program.
 */

export interface ComponentInternalContext {
  webServer: { port: number; register(route: unknown): () => void }
}

export interface ComponentInternalOptions {
  home: string
  name: string
  handle(input: { method: string; path: string; query: URLSearchParams; body: any }): unknown
}

/** Register a loopback-only internal endpoint and publish its discovery file. */
export declare function registerComponentInternal(ctx: ComponentInternalContext, options: ComponentInternalOptions): () => void

export interface ComponentCallRequest {
  home: string
  name: string
  path: string
  body?: unknown
  fetchImpl?: (url: string, options: any) => Promise<any>
  timeoutMs?: number
}

/**
 * Call a component's internal endpoint. Throws without an `error.code` when the
 * component is unreachable, and with the domain code when it answers with an
 * error.
 */
export declare function callComponent<T = any>(request: ComponentCallRequest): Promise<T>
