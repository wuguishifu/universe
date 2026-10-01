import { Metadata } from 'next';
import { JankbotShell } from './components/jankbot-shell';
import { TranscriptFeed } from './components/transcript-feed';

export const metadata: Metadata = {
  title: 'jankbot | wuguishifu',
};

export default function RubyPage() {
  return (
    <JankbotShell current="/jankbot">
      <TranscriptFeed />
    </JankbotShell>
  );
}
