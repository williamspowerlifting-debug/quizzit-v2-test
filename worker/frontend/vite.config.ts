import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // This repository is intended to be deployed as:
  // https://<YOUR-GITHUB-USERNAME>.github.io/quizzit-v2-test/
  base: "/quizzit-v2-test/",
});
