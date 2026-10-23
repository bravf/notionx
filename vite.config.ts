import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ["**/data/**", "**/test-results/**", "**/tests/**"] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            "@tiptap/core",
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-table",
          ],
          ui: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-popover",
            "cmdk",
          ],
          table: ["@tanstack/react-table", "decimal.js"],
        },
      },
    },
  },
});
