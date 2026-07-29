import { auth } from "@clerk/nextjs/server";
import { generateGeminiContentStream } from "@/lib/ai/gemini";
import {
  getRateLimitIdentifier,
  enforceRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";

export async function POST(req) {
  let abortController = null;

  try {
    const authResult = await auth();
    const userId = authResult?.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const subject = getRateLimitIdentifier(req, userId);
    const rateLimitResult = await enforceRateLimit({
      endpoint: "/api/ai/chat",
      subject,
      limitPerMinute: 10,
      burstCapacity: 10,
    });

    if (!rateLimitResult.allowed) {
      return buildRateLimitResponse({
        message: "Too many requests. Please wait before sending another message.",
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        sse: false,
      });
    }

    const body = await req.json();
    let { messages, currentPage, userRole } = body;

    currentPage = String(currentPage || 'Unknown').slice(0, 100).replace(/[^a-zA-Z0-9_/\-]/g, '');
    userRole = String(userRole || 'User').slice(0, 50).replace(/[^a-zA-Z0-9 _\-]/g, '');

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages array is required" }), { status: 400 });
    }

    const isValidMessages = messages.every(msg =>
      msg && typeof msg.content === 'string' && (msg.role === 'user' || msg.role === 'assistant')
    );

    if (!isValidMessages) {
      return new Response(JSON.stringify({ error: "Invalid message format" }), { status: 400 });
    }

    // Convert messages to Gemini format if they are not already
    // Gemini expects: { role: 'user' | 'model', parts: [{ text: '...' }] }
    const geminiHistory = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Extract the latest user message
    const latestMessage = geminiHistory.pop();

    const systemPrompt = `You are the Pathfinder AI Career Mentor. You are a helpful, professional, and encouraging AI assistant embedded inside the Pathfinder web application.
Your goal is to guide the user based on their current context.

Current Page Context: ${currentPage || 'Unknown'}
User Role/Profile: ${userRole || 'User'}

Guidelines:
1. Provide actionable advice related to their current page (e.g. if they are on /resume-match, talk about ATS optimization).
2. Keep responses concise, structured, and easy to read (use markdown).
3. Do not break character. Do not provide information outside of career coaching, resumes, interviews, and skills.
4. Be encouraging and supportive.`;

    const fullPrompt = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [...geminiHistory, latestMessage]
    };

    // Use AbortController so that when the client disconnects (req.signal fires),
    // the AI streaming call is aborted immediately, freeing up server resources.
    abortController = new AbortController();

    // Forward the client disconnect signal to abort the AI streaming call.
    if (req.signal.aborted) {
      abortController.abort();
    } else {
      req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    const encoder = new TextEncoder();
    const result = await generateGeminiContentStream(fullPrompt, { signal: abortController.signal });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            // If the client has disconnected, abort the AI call and stop iterating.
            if (abortController.signal.aborted) {
              break;
            }
            const chunkText = chunk.text();
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          controller.close();
        } catch (error) {
          // Suppress expected abort errors — these are normal when client disconnects.
          if (error.name === 'AbortError' || abortController.signal.aborted) {
            controller.close();
            return;
          }
          console.error("Stream error:", error);
          controller.error(error);
        }
      },
      cancel() {
        // Called when the consumer (client) cancels the stream.
        // Abort the AI call to free server resources immediately.
        if (abortController && !abortController.signal.aborted) {
          abortController.abort();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    console.error("AI Mentor Chat Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
