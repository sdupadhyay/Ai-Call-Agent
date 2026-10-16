import { streamSentences, buildSystemPrompt, ChatMessage } from '../server/src/llm';

async function main() {
  console.log('--- Testing Groq LLM Sentence Streaming ---');
  console.log('Sending test prompt to Groq...\n');

  const systemPrompt = buildSystemPrompt('Jordan', 'Booking a dental cleaning appointment');
  const history: ChatMessage[] = [
    {
      role: 'user',
      content: 'Hi there, I would like to schedule a routine dental checkup and cleaning for next Tuesday afternoon if possible.',
    },
  ];

  const startTime = Date.now();
  let sentenceCount = 0;

  try {
    for await (const sentence of streamSentences(systemPrompt, history)) {
      sentenceCount++;
      const elapsedMs = Date.now() - startTime;
      console.log(`[+${elapsedMs}ms | Sentence ${sentenceCount}]: ${sentence}`);
    }

    const totalElapsedMs = Date.now() - startTime;
    console.log(`\nCompleted stream in ${totalElapsedMs}ms (${sentenceCount} sentences yielded).`);
  } catch (err: unknown) {
    console.error('\nError during LLM stream:', (err as Error).message);
    if ((err as Error).message.includes('LLM_API_KEY')) {
      console.log('\nTip: Add your Groq API key to server/.env:');
      console.log('LLM_API_KEY=gsk_your_groq_api_key_here');
    }
  }
}

main().catch((err) => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
