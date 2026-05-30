import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import z from 'zod';

import crypto from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  TranscriptSegment,
  whisperOutputSchema,
} from '@universe/contracts-emerald';
import { BULL_QUEUE_CONFIG, QueueJob } from '@universe/redis';

import { ClaudeService } from '../../../modules/claude/claude.service';
import { FFmpegService } from '../../../modules/ffmpeg/ffmpeg.service';
import { VideoDataService } from '../../../modules/ffmpeg/video-data.service';
import { WhisperService } from '../../../modules/whisper/whisper.service';

import {
  exampleResponse,
  exampleTranscript,
  systemPrompt,
  userPrompt,
} from './prompts';

const clippingSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    reasoning: z.string(),
    quote_start: z.string(),
    quote_end: z.string(),
    start_seconds: z.number(),
    end_seconds: z.number(),
    clip_title: z.string(),
  }),
  z.object({
    found: z.literal(false),
    reasoning: z.string(),
  }),
]);

function parseWhisperJson(raw: string, speaker: string): TranscriptSegment[] {
  const parsed = whisperOutputSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return [];

  const data = parsed.data;
  return data.transcription
    .map((segment) => ({
      speaker,
      start: segment.offsets.from / 1000,
      end: segment.offsets.to / 1000,
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

const outputDir = path.join('Users', 'bo', 'Desktop', 'trimmed');

@Processor(BULL_QUEUE_CONFIG.trimClip.queueName)
export class TrimClipQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TrimClipQueueProcessor.name);
  private readonly baseTempDir: string;

  constructor(
    private readonly ffmpegService: FFmpegService,
    private readonly videoDataService: VideoDataService,
    private readonly whisperService: WhisperService,
    private readonly claudeService: ClaudeService,
  ) {
    super();

    this.baseTempDir = path.join(tmpdir(), 'universe', 'clipper');
    if (!existsSync(this.baseTempDir))
      mkdirSync(this.baseTempDir, { recursive: true });
  }

  private makeTempDir() {
    const uuid = crypto.randomUUID();
    const tempDir = path.join(this.baseTempDir, uuid);
    mkdirSync(tempDir, { recursive: true });
    const cleanup = () => rmSync(tempDir, { recursive: true, force: true });
    return { tempDir, cleanup };
  }

  override async process(job: QueueJob<'trimClip'>) {
    const { filePath: inputPath } = job.data;
    const { tempDir, cleanup } = this.makeTempDir();

    try {
      const hostAudioPath = path.join(tempDir, 'host.wav');
      const othersAudioPath = path.join(tempDir, 'others.wav');

      this.logger.log('Extracting audio streams...');
      const [hostExtract, othersExtract] = await Promise.all([
        this.ffmpegService.extractAudio({
          inputPath,
          outputPath: hostAudioPath,
          streamIndex: 3,
        }),
        this.ffmpegService.extractAudio({
          inputPath,
          outputPath: othersAudioPath,
          streamIndex: 2,
        }),
      ]);

      if (!hostExtract.success)
        throw new Error(`Host audio extraction failed: ${hostExtract.reason}`);
      if (!othersExtract.success)
        throw new Error(
          `Others audio extraction failed: ${othersExtract.reason}`,
        );

      this.logger.log('Transcribing audio streams...');
      const [hostTranscript, othersTranscript] = await Promise.all([
        this.whisperService.transcribeAudio({ inputPath: hostAudioPath }),
        this.whisperService.transcribeAudio({ inputPath: othersAudioPath }),
      ]);

      if (!hostTranscript.success)
        throw new Error(`Host transcription failed: ${hostTranscript.reason}`);
      if (!othersTranscript.success)
        throw new Error(
          `Others transcription failed: ${othersTranscript.reason}`,
        );

      this.logger.log('Combining transcripts...');
      const [hostRaw, othersRaw] = await Promise.all([
        readFile(hostTranscript.outputPath, 'utf-8'),
        readFile(othersTranscript.outputPath, 'utf-8'),
      ]);

      const segments: TranscriptSegment[] = [
        ...parseWhisperJson(hostRaw, 'host'),
        ...parseWhisperJson(othersRaw, 'others'),
      ].sort((a, b) => a.start - b.start);
      const transcript = JSON.stringify(segments, null, 2);

      this.logger.log('Analyzing with Claude...');
      const response = await this.claudeService.createMessage({
        model: 'claude-sonnet-4-6',
        system: systemPrompt,
        messages: [
          { role: 'user', content: exampleTranscript },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: exampleResponse,
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
          { role: 'user', content: userPrompt(transcript) },
        ],
      });

      if (!response.ok) {
        throw new Error(response.reason);
      }

      this.logger.log(
        `Read ${response.response.usage.cache_read_input_tokens} tokens from cache`,
      );
      this.logger.log(
        `Used ${response.response.usage.input_tokens} input and ${response.response.usage.output_tokens} output tokens`,
      );

      const message = response.response.content[0];
      if (message?.type !== 'text') throw new Error('invalid model response');
      const text = message.text;
      const result = clippingSchema.parse(JSON.parse(text));
      if (!result.found) throw new Error('segment not found');

      const outputPath = path.join(outputDir, `${result.clip_title}.mp4`);
      await this.trimClip({
        inputPath,
        outputPath,
        startS: result.start_seconds,
        endS: result.end_seconds,
      });
    } catch (error) {
      this.logger.error(error instanceof Error ? error.name : 'unknown error');
    } finally {
      cleanup();
    }
  }

  private async trimClip({
    inputPath,
    outputPath,
    startS,
    endS,
  }: {
    inputPath: string;
    outputPath: string;
    startS: number;
    endS: number;
  }) {
    const streamData = await this.videoDataService.getStreamData({
      videoUrl: inputPath,
    });
    const streams = streamData.streams;
    if (!streams.length) throw new Error('No streams found');

    const videoStream = streams.find((s) => s.codec_type === 'video');
    if (!videoStream) throw new Error('No video stream found');

    const duration = this.videoDataService.getVideoDuration(videoStream);
    if (duration === null) throw new Error('Could not determine duration');

    const frameRateData = this.videoDataService.getVideoFrameRate(videoStream);
    if (startS * 1000 > duration)
      throw new Error(
        `Invalid start timestamp ${startS * 1000} ms for video of duration ${duration} ms`,
      );

    const codec = this.videoDataService.getVideoCodec(videoStream);
    const resolution = this.videoDataService.getVideoResolution(videoStream);

    const result = await this.ffmpegService.splitVideo({
      filePath: inputPath,
      startTimestamp: startS,
      endTimestamp: endS,
      outputFilePath: outputPath,
      codec,
      resolution,
      frameRate: frameRateData?.rFrameRate,
    });

    if (!result.success) throw new Error(result.reason);
  }
}
