import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "../../package.json";

export default defineConfig({ plugins: [react(), {
  name: "app-version",
  transformIndexHtml() {
    return [{ tag: "meta", attrs: { name: "app-version", content: version }, injectTo: "head" }];
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) + "\n" });
  },
}] });
