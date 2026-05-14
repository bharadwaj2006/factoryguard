import { defineConfig } from "vite";
// @ts-expect-error — viteReact is exported as default but d.ts uses non-standard "export { viteReact as default }"
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  plugins: [
    tanstackStart(),
    tsconfigPaths(),
    tailwindcss(),
    react(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
});
