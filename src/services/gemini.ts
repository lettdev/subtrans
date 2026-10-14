import { ApiError, GoogleGenAI } from "@google/genai";
import {
  GeminiBatchResponse,
  GeminiTranslation,
  GeminiUsage,
  parseGeminiBatchResponse,
} from "../domain/translation";

export type GeminiFailureKind = "aborted" | "quota" | "auth" | "network" | "response";

export class GeminiTranslationError extends Error {
  constructor(
    public readonly kind: GeminiFailureKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiTranslationError";
  }
}

export interface TranslateGeminiBatchOptions {
  apiKey: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  onPartial?: (translations: GeminiTranslation[]) => void;
}

export interface TranslateGeminiBatchResult extends GeminiBatchResponse {
  usage: GeminiUsage;
  rawText: string;
}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["translations", "memory"],
  propertyOrdering: ["translations", "memory"],
  properties: {
    translations: {
      type: "array",
      description: "One translated subtitle for every input id, in the same order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        propertyOrdering: ["id", "text"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    memory: {
      type: "string",
      description: "Compact durable translation memory, maximum 1200 characters.",
    },
  },
};

export async function translateGeminiBatch(options: TranslateGeminiBatchOptions): Promise<TranslateGeminiBatchResult> {
  if (!options.apiKey.trim()) throw new GeminiTranslationError("auth", "Chưa có Gemini API key.");
  const client = new GoogleGenAI({ apiKey: options.apiKey.trim() });
  let rawText = "";
  let usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  try {
    const stream = await client.models.generateContentStream({
      model: options.model,
      contents: options.prompt,
      config: {
        abortSignal: options.signal,
        automaticContinuation: false,
        temperature: 0.2,
        maxOutputTokens: 32_768,
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    });

    for await (const chunk of stream) {
      rawText += chunk.text ?? "";
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? usage.inputTokens,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? usage.outputTokens,
          totalTokens: chunk.usageMetadata.totalTokenCount ?? usage.totalTokens,
        };
      }
      const partial = parseGeminiBatchResponse(rawText).translations;
      if (partial.length) options.onPartial?.(partial);
    }
  } catch (error) {
    if (options.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new GeminiTranslationError("aborted", "Đã tạm dừng theo yêu cầu.");
    }
    if (error instanceof ApiError) {
      if (error.status === 429) {
        throw new GeminiTranslationError("quota", "Gemini báo hết quota hoặc vượt rate limit. Phần đã dịch đã được giữ lại.", 429);
      }
      if (error.status === 401 || error.status === 403) {
        throw new GeminiTranslationError("auth", "API key không hợp lệ hoặc chưa được cấp quyền dùng Gemini.", error.status);
      }
      throw new GeminiTranslationError("network", `Gemini trả về lỗi ${error.status}: ${error.message}`, error.status);
    }
    throw new GeminiTranslationError("network", error instanceof Error ? error.message : "Không thể kết nối Gemini.");
  }

  const parsed = parseGeminiBatchResponse(rawText);
  if (!parsed.translations.length) {
    throw new GeminiTranslationError("response", "Gemini không trả về cue dịch hợp lệ. Không có nội dung nào bị ghi đè.");
  }
  return { ...parsed, usage, rawText };
}
