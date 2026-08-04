import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateQuiz, saveQuizResult, getAssessment } from "../actions/interview.js";

// Use vi.hoisted to create mocks BEFORE vi.mock runs (stable references)
const mocks = vi.hoisted(() => {
  const findUniqueUserMock = vi.fn();
  return {
    auth: vi.fn(),
    findUniqueUser: findUniqueUserMock,
    userFindUnique: findUniqueUserMock,
    createAssessment: vi.fn(),
    generateGeminiContent: vi.fn(),
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    cacheDelete: vi.fn(),
    assessmentFindFirst: vi.fn(),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    formatResetTime: vi.fn().mockReturnValue("1h"),
    decrementRateLimit: vi.fn(),
    dbQueryRaw: vi.fn(),
    aiRateLimitFindUnique: vi.fn(),
    aiRateLimitUpsert: vi.fn(),
    aiRateLimitUpdate: vi.fn(),
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db/prisma", () => ({
  db: {
    user: {
      findUnique: mocks.findUniqueUser,
    },
    assessment: {
      create: mocks.createAssessment,
      findFirst: mocks.assessmentFindFirst,
    },
    aiRateLimit: {
      findUnique: mocks.aiRateLimitFindUnique,
      upsert: mocks.aiRateLimitUpsert,
      update: mocks.aiRateLimitUpdate,
    },
    $queryRaw: mocks.dbQueryRaw,
  },
}));

vi.mock("@/lib/security/rate-limit-actions", () => ({
  checkRateLimit: mocks.checkRateLimit,
  decrementRateLimit: mocks.decrementRateLimit,
  formatResetTime: mocks.formatResetTime,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiContent: mocks.generateGeminiContent,
}));

vi.mock("@/lib/cache", () => ({
  getCacheStore: () => ({
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    delete: mocks.cacheDelete,
  }),
  cacheStore: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
    delete: mocks.cacheDelete,
  },
}));

describe("interview actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQueryRaw.mockResolvedValue([{ count: 1 }]);
    mocks.aiRateLimitFindUnique.mockResolvedValue(null);
    mocks.aiRateLimitUpsert.mockResolvedValue({ count: 1 });
    mocks.aiRateLimitUpdate.mockResolvedValue({});
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.formatResetTime.mockReturnValue("1h");
    mocks.cacheGet.mockResolvedValue(undefined); // cache miss = calls AI
  });

  describe("generateQuiz", () => {
    it("successfully generates quiz questions and stores them in cache under a session ID", async () => {
      mocks.auth.mockResolvedValue({ userId: "clerk-user-1" });
      mocks.findUniqueUser.mockResolvedValue({
        id: "user-1",
        industry: "technology",
        skills: ["javascript", "react"],
      });

      mocks.generateGeminiContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              questions: [
                {
                  question: "What is 2+2?",
                  options: ["3", "4", "5", "6"],
                  correctAnswer: "4",
                  explanation: "Basic math",
                },
              ],
            }),
        },
      });

      const result = await generateQuiz("Technical");

      expect(result).toHaveProperty("sessionId");
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].question).toBe("What is 2+2?");
      expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
    });

    it("falls back to default questions and caches them when AI generation fails", async () => {
      mocks.auth.mockResolvedValue({ userId: "clerk-user-1" });
      mocks.findUniqueUser.mockResolvedValue({
        id: "user-1",
        industry: "technology",
        skills: ["javascript", "react"],
      });
      mocks.generateGeminiContent.mockRejectedValue(new Error("AI service down"));

      const result = await generateQuiz("Technical");

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("questions");
      expect(result.isFallback).toBe(true);
    });
  });

  describe("saveQuizResult", () => {
    it("recalculates the score server-side based on cached questions and saves it", async () => {
      mocks.auth.mockResolvedValue({ userId: "clerk-user-1" });
      mocks.findUniqueUser.mockResolvedValue({
        id: "user-1",
        industry: "technology",
      });

      const cachedQuestions = [
        {
          question: "What is 2+2?",
          options: ["3", "4", "5", "6"],
          correctAnswer: "4",
          explanation: "Basic math",
        },
        {
          question: "What is React?",
          options: ["Library", "Framework", "OS", "Database"],
          correctAnswer: "Library",
          explanation: "UI Library",
        },
      ];

      mocks.cacheGet.mockResolvedValue({
        status: "success",
        value: cachedQuestions,
        isSuccess: true,
        isMiss: false,
        isError: false,
      });
      mocks.createAssessment.mockImplementation(({ data }) =>
        Promise.resolve({ id: "assessment-1", ...data })
      );

      const sessionId = "12345678-1234-1234-1234-1234567890ab";
      const result = await saveQuizResult(sessionId, ["4", "Framework"], "Technical");

      expect(mocks.cacheGet).toHaveBeenCalledTimes(1);
      expect(mocks.cacheDelete).toHaveBeenCalledTimes(1);
      expect(result.quizScore).toBe(50);
      expect(result.userId).toBe("user-1");
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].isCorrect).toBe(true);
      expect(result.questions[1].isCorrect).toBe(false);
    });

    it("returns error if the session is not found in cache", async () => {
      mocks.auth.mockResolvedValue({ userId: "clerk-user-1" });
      mocks.findUniqueUser.mockResolvedValue({
        id: "user-1",
        industry: "technology",
      });

      mocks.cacheGet.mockResolvedValue({
        status: "miss",
        value: null,
        isSuccess: false,
        isMiss: true,
        isError: false,
      });

      const sessionId = "12345678-1234-1234-1234-1234567890ac";
      const result = await saveQuizResult(sessionId, ["4"], "Technical");

      expect(result.success).toBe(false);
      expect(result.errors).toHaveProperty("_form");
      expect(mocks.cacheDelete).not.toHaveBeenCalled();
    });
  });

  describe("getAssessment", () => {
    it("returns null if user is not authenticated", async () => {
      mocks.auth.mockResolvedValue({ userId: null });
      const result = await getAssessment("assessment-1");
      expect(result).toBeNull();
    });

    it("returns null if user is not found in database", async () => {
      mocks.auth.mockResolvedValue({ userId: "clerk-1" });
      mocks.findUniqueUser.mockResolvedValue(null);
      const result = await getAssessment("assessment-1");
      expect(result).toBeNull();
    });

    it("fetches assessment using findFirst with id and userId", async () => {
      const mockUser = { id: "user-1", clerkUserId: "clerk-1" };
      const mockAssessment = { id: "assessment-1", userId: "user-1" };

      mocks.auth.mockResolvedValue({ userId: "clerk-1" });
      mocks.findUniqueUser.mockResolvedValue(mockUser);
      mocks.assessmentFindFirst.mockResolvedValue(mockAssessment);

      const result = await getAssessment("assessment-1");

      expect(result).toEqual(mockAssessment);
      expect(mocks.assessmentFindFirst).toHaveBeenCalledWith({
        where: { id: "assessment-1", userId: "user-1" },
      });
    });
  });
});
