declare namespace Cloudflare {
  interface Env {
    /** Set with `wrangler secret put ANTHROPIC_API_KEY` (or in .dev.vars for local dev). */
    ANTHROPIC_API_KEY?: string;
  }
}
