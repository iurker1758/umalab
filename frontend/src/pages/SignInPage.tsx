import { useSearchParams } from "react-router";

// Mirrors the closed set of codes `routers/auth.py` redirects with; an
// unknown code gets the generic line rather than echoing the URL.
const REASONS: Record<string, string> = {
  denied: "Discord sign-in was cancelled.",
  not_member: "Your Discord account isn't in the server this app is for.",
  no_role: "Your Discord account doesn't have the role this app is for.",
  state: "That sign-in attempt went stale — try again.",
  discord: "Discord didn't answer properly — try again in a moment.",
};

export function SignInPage() {
  const [params] = useSearchParams();
  const code = params.get("error");
  const reason = code === null ? null : (REASONS[code] ?? "Sign-in failed — try again.");
  return (
    <div className="signin">
      <h2>Sign In</h2>
      <p>UmaLab is open to members of its Discord server with the right role.</p>
      {reason && (
        <p className="signin-reason" role="alert">
          {reason}
        </p>
      )}
      {/* A navigation, not a fetch: /api/auth/login answers with the redirect
          to Discord, and the browser has to follow it. */}
      <a className="button" href="/api/auth/login">
        Sign In with Discord
      </a>
    </div>
  );
}
