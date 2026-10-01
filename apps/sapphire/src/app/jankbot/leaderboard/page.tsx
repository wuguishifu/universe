import { Metadata } from 'next';
import { JankbotShell } from '../components/jankbot-shell';
import { PhraseLeaderboard } from '../components/phrase-leaderboard';

export const metadata: Metadata = {
  title: 'jankbot leaderboard | wuguishifu',
};

export default function RubyLeaderboardPage() {
  return (
    <JankbotShell current="/jankbot/leaderboard">
      <PhraseLeaderboard />
    </JankbotShell>
  );
}
