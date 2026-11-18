// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    /** Fine-grained GitHub token, read-only access to public repositories. */
    GITHUB_TOKEN?: string;
  }
}
