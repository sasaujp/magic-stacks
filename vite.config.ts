import { cloudflare } from "@cloudflare/vite-plugin";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// In dev, the Workers SSR environment pre-bundles dependencies. Solid packages must not be
// pre-bundled there: a second copy of solid-js or of @solidjs/start's server-function registry
// breaks hydration and server-function lookup ("invalid server function").
const SOLID_DEPS = ["solid-js", "solid-js/web", "solid-js/store", "@solidjs/start", "@solidjs/start/fns/server", "@solidjs/router", "@kobalte/core", "lucide-solid"];

export default defineConfig({
  // SPA: the Worker serves an empty shell plus server functions / API routes; pages render in the browser.
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), solidStart({ ssr: false, middleware: "./src/middleware.ts" }), tailwindcss()],
  environments: {
    ssr: {
      optimizeDeps: { exclude: SOLID_DEPS },
    },
  },
});
