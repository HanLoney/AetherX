import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const productVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
).version;

export default defineConfig({
  define: {
    __AETHERX_VERSION__: JSON.stringify(productVersion)
  },
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === "emoji-picker"
        }
      }
    })
  ],
  server: {
    host: "127.0.0.1",
    port: 5174
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
