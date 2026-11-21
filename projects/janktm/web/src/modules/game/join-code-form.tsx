'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Input } from '@libs/ui-web';

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (cleaned) router.push(`/game/${cleaned}`);
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD"
        aria-label="Party code"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={8}
        className="h-16 rounded-xl bg-card text-center font-mono text-3xl tracking-[0.4em] uppercase md:text-3xl"
      />
      <Button
        type="submit"
        size="lg"
        className="h-12 text-base"
        disabled={!cleaned}
      >
        Join party
      </Button>
    </form>
  );
}
