import OpenAI from 'openai';
import { env } from './env.js';

/**
 * Singleton OpenAI client used by the LLM parsing stage
 * (src/services/llmParser.ts) to turn raw listing text into
 * CleanListing structures.
 *
 * The API key comes from the validated environment — never hardcode it.
 */
export const openai: OpenAI = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});
