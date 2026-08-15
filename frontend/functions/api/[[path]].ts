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
  // The browser, not the proxy, follows any backend redirect — but Starlette
  // builds absolute Locations from the rewritten URL (measured: the
  // trailing-slash 307), which would send the browser to the tunnel hostname
  // and out of the same-origin design. Point those back through this origin.
  const response = await fetch(new Request(url, request), { redirect: 'manual' })
  const location = response.headers.get('Location')
  if (location?.startsWith(origin.origin)) {
    const headers = new Headers(response.headers)
    const appOrigin = new URL(request.url).origin
    headers.set('Location', appOrigin + location.slice(origin.origin.length))
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  return response
}
