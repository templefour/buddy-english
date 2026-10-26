import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// On custom domains a zone-level Cloudflare "Rocket Loader" (Speed →
// Optimization) rewrites <script> tags. Tagging scripts with
// `data-cfasync="false"` is the official way to tell Rocket Loader to leave
// them alone. This also helps when a custom domain sits behind a proxy that
// rewrites scripts.
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
  plugins: [react(), tailwindcss(), cloudflare(), disableRocketLoaderOnScripts()]
});
