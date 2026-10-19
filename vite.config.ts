import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// On custom domains, a zone-level Cloudflare "Rocket Loader" (Speed →
// Optimization) rewrites <script> tags. When it rewrites our large ES-module
// bundle it has been observed to truncate the file, which makes the page render
// blank. Tagging scripts with `data-cfasync="false"` is the official way to tell
// Rocket Loader to leave them alone. This also helps when a custom domain sits
// behind a proxy that rewrites scripts.
// See: https://developers.cloudflare.com/speed/optimization/content/rocket-loader/
function disableRocketLoaderOnScripts(): Plugin {
  return {
    name: "disable-rocket-loader",
    transformIndexHtml(html) {
      return html.replace(/<script\b([^>]*)>/gi, (match, attrs: string) => {
        if (/\bdata-cfasync\b/i.test(attrs)) return match;
        return `<script data-cfasync="false"${attrs}>`;
      });
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    disableRocketLoaderOnScripts()
  ],
  build: {
    // Split the large bundle into several smaller chunks. On some custom
    // domains a big single JS file (~494KB) gets truncated mid-transfer by an
    // upstream proxy (observed: only ~417KB arrives). Keeping each chunk well
    // under that threshold maximizes the chance the browser receives complete
    // files so the app can boot.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@cloudflare/kumo") || id.includes("@phosphor-icons"))
            return "ui";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          if (
            id.includes("agents") ||
            id.includes("@ai-sdk") ||
            id.includes("zod") ||
            id.includes("workers-ai-provider")
          )
            return "agent";
          if (id.includes("tailwind") || id.includes("@tailwindcss"))
            return "styles";
          return "vendor";
        }
      }
    }
  }
});
