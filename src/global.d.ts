/// <reference types="@solidjs/start/env" />

declare namespace App {
  interface RequestEventLocals {
    /** Signed-in user, resolved from the session cookie by src/middleware.ts. */
    user?: import("~/server/auth").SessionUser | null;
  }
}
