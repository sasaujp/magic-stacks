import { A, createAsync, Router, useLocation, useNavigate } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { ErrorBoundary, type JSX, onMount, Show, Suspense, createEffect } from "solid-js";
import { Library, NotebookPen, UserRound } from "lucide-solid";
import { AppError } from "~/components/AppError";
import { Button } from "~/components/ui/button";
import { meQuery } from "~/lib/queries";
import { installGlobalErrorReporting } from "~/lib/report-error";
import "./app.css";

/** Pages reachable without signing in. */
const PUBLIC_PATHS = [/^\/login$/, /^\/invite\//, /^\/link\//];

export default function App() {
  onMount(installGlobalErrorReporting);
  return (
    <Router
      root={props => (
        <div class="flex min-h-screen flex-col">
          <header class="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div class="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
              <A href="/" class="flex items-center gap-2 font-semibold tracking-tight" aria-label="Magic Stacks（トップ）">
                <NotebookPen class="size-5" aria-hidden="true" />
                <span class="hidden sm:inline">Magic Stacks</span>
              </A>
              <span class="hidden text-sm text-muted-foreground lg:inline">英語の古典を 1 文ずつ読み、訳すノート</span>
              <HeaderControls />
            </div>
          </header>
          <main class="flex-1">
            <ErrorBoundary fallback={(error, reset) => <AppError error={error} reset={reset} />}>
              <Suspense>
                <RequireUser>{props.children}</RequireUser>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

/** Sends signed-out visitors to /login (the SPA shell itself is public; the data endpoints are guarded). */
function RequireUser(props: { children: JSX.Element }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isPublic = () => PUBLIC_PATHS.some(re => re.test(location.pathname));
  const me = createAsync(() => meQuery());
  createEffect(() => {
    if (!isPublic() && me() === null) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  });
  return <Show when={isPublic() || me()}>{props.children}</Show>;
}

function HeaderControls() {
  const me = createAsync(() => meQuery());
  return (
    <div class="ml-auto flex items-center gap-1">
      <Suspense>
        <Show when={me()}>
          {user => (
            <>
              <Button as={A} href="/library" variant="ghost" size="sm" aria-label="書庫">
                <Library class="size-4" aria-hidden="true" />
                <span class="hidden md:inline">書庫</span>
              </Button>
              <Button as={A} href="/account" variant="ghost" size="sm" aria-label={`アカウント（${user().username}）`}>
                <UserRound class="size-4" aria-hidden="true" />
                <span class="hidden md:inline">{user().username}</span>
              </Button>
            </>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
