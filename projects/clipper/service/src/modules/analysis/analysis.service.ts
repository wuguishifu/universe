import { Injectable } from '@nestjs/common';
import { ClaudeService } from '@libs/nest-common';
import { ClipResult, clipResultSchema } from '@projects/clipper-contracts';
import {
  exampleResponses,
  exampleTranscripts,
  systemPrompt,
  userPrompt,
} from './prompts';

@Injectable()
export class AnalysisService {
  constructor(private readonly claudeService: ClaudeService) {}

  public async analyzeTranscript({
    transcript,
  }: {
    transcript: string;
  }): Promise<ClipResult> {
    const response = await this.claudeService.createMessage({
      model: 'claude-sonnet-4-6',
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt(JSON.stringify(exampleTranscripts[0], null, 2)),
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify(exampleResponses[0], null, 2),
              cache_control: {
                type: 'ephemeral',
                ttl: '5m',
              },
            },
          ],
        },
        {
          role: 'user',
          content: userPrompt(transcript),
        },
      ],
    });

    if (!response.ok) throw new Error(response.reason);

    const message = response.response.content[0];
    if (message?.type !== 'text') throw new Error('invalid model response');
    const text = message.text;
    return clipResultSchema.parse(JSON.parse(text));
  }
}
