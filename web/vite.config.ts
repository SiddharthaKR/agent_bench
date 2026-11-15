import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the browser app runs on 5173 and forwards /api to the local server.
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: { "/api": { target: "http://localhost:4600", changeOrigin: false } },
	},
	build: { outDir: "dist", emptyOutDir: true },
});
