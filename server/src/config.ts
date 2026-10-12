import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from the server package directory first, falling back to process.cwd()
// This ensures environment variables are found whether run from root or server/
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

// Define schema for runtime environment variable validation
// PORT is coerced to number and defaults to 3000 if not specified
// All other credentials and names are optional during initial setup
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  
  DEEPGRAM_API_KEY: z.string().optional(),
  
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  
  AGENT_NAME: z.string().optional(),
  COMPANY_NAME: z.string().optional(),
});

// Parse and export the validated environment configuration
export const config = envSchema.parse(process.env);
