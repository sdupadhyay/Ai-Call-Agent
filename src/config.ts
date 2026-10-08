import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

// Define the schema for our environment variables
// This ensures we have the correct types and required variables at runtime
const envSchema = z.object({
  PORT: z.coerce.number().default(3000), // Coerce string to number, default to 3000
  PUBLIC_HOST: z.string().optional(),
  
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  
  DEEPGRAM_API_KEY: z.string().optional(),
  
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

// Parse and validate the environment variables
export const config = envSchema.parse(process.env);
