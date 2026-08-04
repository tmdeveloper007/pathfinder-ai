import { describe, expect, it, vi, beforeEach } from "vitest";
import { server } from "./mocks/server.mjs";
import { http, HttpResponse } from "msw";

// Use vi.hoisted like other passing tests in this repo
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  generateGeminiContent: vi.fn(),
  safeFetch: vi.fn(async () => ({
    success: true,
    text: "<html><body><h1>Software Engineer</h1><p>Tech Corp</p></body></html>",
    status: 200,
  })),
  db: { $queryRaw: vi.fn() },
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  decrementRateLimit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiContent: mocks.generateGeminiContent,
}));

vi.mock("@/lib/security/safe-fetch", () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock("@/lib/db/prisma", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/security/rate-limit-actions", () => ({
  checkRateLimit: mocks.checkRateLimit,
  decrementRateLimit: mocks.decrementRateLimit,
}));

import { parseJobUrl } from "../actions/job-scraper.js";

describe("parseJobUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully parses a job URL using generateGeminiContent and parseAIJson", async () => {
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.db.$queryRaw.mockResolvedValue([{ count: 1 }]);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });

    // Mock the HTTP request using MSW
    server.use(
      http.get("https://example.com/jobs/1", () => {
        return HttpResponse.text("<html><body><h1>Software Engineer</h1><p>Tech Corp</p></body></html>");
      })
    );

    mocks.generateGeminiContent.mockResolvedValue({
      response: {
        text: () => "```json\n{\n  \"companyName\": \"Tech Corp\",\n  \"jobTitle\": \"Software Engineer\",\n  \"location\": \"San Francisco, CA\",\n  \"salary\": \"$150k - $180k\",\n  \"jobDescription\": \"We are looking for a Software Engineer.\"\n}\n```",
      },
    });

    const result = await parseJobUrl("https://example.com/jobs/1");

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      companyName: "Tech Corp",
      jobTitle: "Software Engineer",
      location: "San Francisco, CA",
      salary: "$150k - $180k",
      jobDescription: "We are looking for a Software Engineer.",
    });
    expect(mocks.generateGeminiContent).toHaveBeenCalled();
  });

  it("returns unauthorized error if user is not logged in", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const result = await parseJobUrl("https://example.com/jobs/1");
    expect(result.success).toBe(false);
    expect(result.errors._form).toContain("Unauthorized");
  });
});
