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
  let origin: URL
  try {
    origin = new URL(env.API_ORIGIN ?? '')
  } catch {
    return new Response('API_ORIGIN is missing or not a URL', { status: 500 })
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    return new Response('API_ORIGIN must be a bare origin', { status: 500 })
  }
  const url = new URL(request.url)
  const appOrigin = url.origin
  url.protocol = origin.protocol
  url.host = origin.host
  // The browser, not the proxy, follows any backend redirect — but Starlette
  // builds absolute Locations from the rewritten URL (measured: the
  // trailing-slash 307), which would send the browser to the tunnel hostname
  // and out of the same-origin design. Point those back through this origin.
  // Matched on the parsed host, not a string prefix: behind the
  // TLS-terminating tunnel the backend may emit an http Location for an
  // https API_ORIGIN, and a prefix match mangles look-alike foreign hosts.
  const response = await fetch(new Request(url, request), { redirect: 'manual' })
  const location = response.headers.get('Location')
  if (location) {
    let target: URL | undefined
    try {
      target = new URL(location)
    } catch {
      // A relative Location is already origin-safe.
    }
    if (target && target.host === origin.host) {
      const headers = new Headers(response.headers)
      headers.set('Location', appOrigin + target.pathname + target.search + target.hash)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
  }
  return response
}
