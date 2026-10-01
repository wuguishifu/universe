import { SignInButton, UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Metadata } from 'next';
import { Section } from '../../modules/layout/section';
import { TranscriptFeed } from './components/transcript-feed';

export const metadata: Metadata = {
  title: 'jankbot | wuguishifu',
};

export default async function RubyPage() {
  const { userId } = await auth();

  return (
    <main className="flex flex-col gap-2">
      <Section className="flex items-center justify-between">
        <h2>jankbot</h2>
        {userId && <UserButton />}
      </Section>
      {userId ? (
        <TranscriptFeed />
      ) : (
        <Section className="font-vga flex flex-col items-start gap-2">
          <SignInButton mode="modal">
            <button className="px-4 py-2 border border-gray-400/20 rounded-sm hover:bg-gray-400/10 transition-all duration-150">
              sign in with discord
            </button>
          </SignInButton>
        </Section>
      )}
    </main>
  );
}
