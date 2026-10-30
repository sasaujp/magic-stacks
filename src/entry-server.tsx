// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

// Follow the OS colour scheme (Solid UI uses the `.dark` class).
const themeScript = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const a=()=>document.documentElement.classList.toggle("dark",m.matches);a();m.addEventListener("change",a)})()`;

// SPA (ssr: false in vite.config.ts): this document is the empty shell the client renders into.
export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Magic Stacks — 1 文ずつ訳す翻訳ノート</title>
          <link rel="icon" href="/favicon.ico" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;600&display=swap"
          />
          <script innerHTML={themeScript} />
          {assets}
        </head>
        <body class="min-h-screen bg-background text-foreground antialiased">
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
