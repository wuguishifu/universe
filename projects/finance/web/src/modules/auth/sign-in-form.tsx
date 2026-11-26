'use client';

import { useAuthActions } from '@convex-dev/auth/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
} from '@libs/ui-web';

type Flow = 'signIn' | 'signUp';

/**
 * Email + password. "Create account" only works for emails in the deployment's
 * AUTH_SIGNUP_ALLOWLIST (platform/convex/app/convex/auth.ts).
 */
export function SignInForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>('signIn');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('flow', flow);
    setPending(true);
    setError(null);
    try {
      await signIn('password', formData);
      router.replace('/');
    } catch (caught) {
      setError(errorMessage(caught, flow));
      setPending(false);
    }
  };

  const signingUp = flow === 'signUp';

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{signingUp ? 'Create your account' : 'Sign in'}</CardTitle>
        <CardDescription>
          {signingUp
            ? 'Sign-ups are closed except for invited emails.'
            : 'Use the email and password you signed up with.'}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              minLength={signingUp ? 8 : undefined}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            {signingUp ? 'Create account' : 'Sign in'}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              setFlow(signingUp ? 'signIn' : 'signUp');
              setError(null);
            }}
          >
            {signingUp
              ? 'Already have an account? Sign in'
              : 'First time? Create your account'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/**
 * Convex Auth's errors reach the client as text with the server's ConvexError data somewhere in it,
 * so look for our codes (see auth.ts) rather than parsing.
 */
function errorMessage(error: unknown, flow: Flow): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('SIGN_UPS_CLOSED')) {
    return "Sign-ups are closed, and that email isn't invited.";
  }
  if (flow === 'signUp') {
    return text.includes('already exists')
      ? 'That email already has an account. Sign in instead.'
      : "Couldn't create your account. Passwords need at least 8 characters.";
  }
  return "Couldn't sign in. Check your email and password.";
}
