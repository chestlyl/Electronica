import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test-only environment variables.
    // These are safe, non-functional values used only to satisfy startup
    // validation during unit tests. They do not connect to a real database.
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      SUPABASE_JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      DATABASE_URL: "http://test-db-host:5432/test",
      API_URL: "http://localhost:4000",
      API_SECRET: "test-api-secret",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    },
  },
});
