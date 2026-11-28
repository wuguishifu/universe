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
} from '@libs/web-ui';

import { DEFAULT_HOME_PATH } from './paths';

type Step =
  | { kind: 'signIn' }
  | { kind: 'signUp' }
  /** A code was emailed to verify the address (first sign-in, or right after sign-up). */
  | { kind: 'verify'; email: string }
  | { kind: 'forgot' }
  /** A code was emailed to reset the password. */
  | { kind: 'reset'; email: string };

const COPY: Record<
  Step['kind'],
  { title: string; description: string; submit: string }
> = {
  signIn: {
    title: 'Sign in',
    description: 'Use the email and password you signed up with.',
    submit: 'Sign in',
  },
  signUp: {
    title: 'Create your account',
    description: 'Sign-ups are invite-only.',
    submit: 'Create account',
  },
  verify: {
    title: 'Check your email',
    description: 'We sent a code to',
    submit: 'Verify',
  },
  forgot: {
    title: 'Reset your password',
    description: "We'll email you a code to reset it with.",
    submit: 'Send code',
  },
  reset: {
    title: 'Choose a new password',
    description: 'We sent a code to',
    submit: 'Reset password',
  },
};

/**
 * Email + password with Convex Auth (platform/convex/app/convex/auth.ts): sign in, sign up for an
 * invited email, verify the email with a code on the first sign-in, and reset a forgotten password.
 * Goes to `redirectTo` once signed in, where the proxy takes over.
 */
export function SignInForm({
  appName,
  redirectTo = DEFAULT_HOME_PATH,
}: {
  appName?: string;
  /** A path on this site. Pass the page's `redirectTo` search param through safeRedirectPath. */
  redirectTo?: string;
}) {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'signIn' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '');
    setPending(true);
    setError(null);
    try {
      switch (step.kind) {
        case 'signIn':
        case 'signUp': {
          const email = field('email');
          const { signingIn } = await signIn('password', {
            flow: step.kind,
            email,
            password: field('password'),
          });
          // Not signed in yet means the address still needs verifying, and a code is on its way.
          if (signingIn) return router.replace(redirectTo);
          setPending(false);
          return goTo({ kind: 'verify', email });
        }
        case 'verify': {
          const { signingIn } = await signIn('password', {
            flow: 'email-verification',
            email: step.email,
            code: field('code'),
          });
          if (signingIn) return router.replace(redirectTo);
          throw new Error('Invalid code');
        }
        case 'forgot': {
          const email = field('email');
          await signIn('password', { flow: 'reset', email });
          setPending(false);
          return goTo({ kind: 'reset', email });
        }
        case 'reset': {
          const { signingIn } = await signIn('password', {
            flow: 'reset-verification',
            email: step.email,
            code: field('code'),
            newPassword: field('newPassword'),
          });
          if (signingIn) return router.replace(redirectTo);
          throw new Error('Invalid code');
        }
      }
    } catch (caught) {
      setError(errorMessage(caught, step));
      setPending(false);
    }
  };

  const copy = COPY[step.kind];
  const sentTo = 'email' in step ? step.email : null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {copy.title}
          {appName && step.kind === 'signIn' ? ` to ${appName}` : ''}
        </CardTitle>
        <CardDescription>
          {copy.description}
          {sentTo && (
            <>
              {' '}
              <span className="font-medium text-foreground">{sentTo}</span>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      {/* Keyed by step so each step starts with empty fields. */}
      <form key={step.kind} onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {(step.kind === 'signIn' ||
            step.kind === 'signUp' ||
            step.kind === 'forgot') && (
            <Field
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
            />
          )}
          {(step.kind === 'signIn' || step.kind === 'signUp') && (
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete={
                step.kind === 'signUp' ? 'new-password' : 'current-password'
              }
              minLength={step.kind === 'signUp' ? 8 : undefined}
            />
          )}
          {(step.kind === 'verify' || step.kind === 'reset') && (
            <Field
              name="code"
              label="Code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
            />
          )}
          {step.kind === 'reset' && (
            <Field
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={8}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            {copy.submit}
          </Button>
          {step.kind === 'signIn' && (
            <>
              <LinkButton onClick={() => goTo({ kind: 'signUp' })}>
                First time? Create your account
              </LinkButton>
              <LinkButton onClick={() => goTo({ kind: 'forgot' })}>
                Forgot your password?
              </LinkButton>
            </>
          )}
          {step.kind !== 'signIn' && (
            <LinkButton onClick={() => goTo({ kind: 'signIn' })}>
              Back to sign in
            </LinkButton>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}

function Field({
  name,
  label,
  ...input
}: { name: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...input} />
    </div>
  );
}

function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" variant="link" size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Convex Auth's errors reach the client as text with the server's message (and any ConvexError
 * data) somewhere in it, so look for the known ones rather than parsing.
 */
function errorMessage(error: unknown, step: Step): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('not_invited')) {
    return "Sign-ups are invite-only, and that email isn't invited.";
  }
  if (text.includes('no_access')) {
    return "This account isn't invited to anything anymore.";
  }
  if (text.includes('TooManyFailedAttempts')) {
    return 'Too many attempts. Try again in a little while.';
  }
  if (text.includes('Invalid password')) {
    return 'Passwords need at least 8 characters.';
  }
  switch (step.kind) {
    case 'signUp':
      return text.includes('already exists')
        ? 'That email already has an account. Sign in instead.'
        : "Couldn't create your account.";
    case 'verify':
    case 'reset':
      return "That code didn't work. Check it, or go back and get a new one.";
    case 'forgot':
      return "Couldn't send a code to that email.";
    case 'signIn':
      return "Couldn't sign in. Check your email and password.";
  }
}
