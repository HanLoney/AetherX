import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
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
