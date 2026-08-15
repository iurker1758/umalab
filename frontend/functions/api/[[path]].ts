// Cloudflare Pages Function — exists only in the deployed app, where Vite's
// dev proxy doesn't (DECISIONS.md #53). API_ORIGIN is set on the Pages
// project, never in the repo: the tunnel hostname in production, a local
// backend under `wrangler pages dev`.
interface Env {
  API_ORIGIN?: string
}

export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Env
}): Promise<Response> {
  if (!env.API_ORIGIN) {
    return new Response('API_ORIGIN is not configured', { status: 500 })
  }
  const origin = new URL(env.API_ORIGIN)
  const url = new URL(request.url)
  url.protocol = origin.protocol
  url.host = origin.host
  // The browser, not the proxy, follows any backend redirect.
  return fetch(new Request(url, request), { redirect: 'manual' })
}
