import { useEffect, useId, useState } from 'react';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Input,
  Label,
} from '@libs/ui-web';
import type { Account } from '@projects/mega-client-contracts';
import { api, expect } from '../lib/api';
import { useApiMutation } from '../lib/use-api-mutation';

export function AccountDrawer({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[env(safe-area-inset-bottom)]">
          <DrawerHeader>
            <DrawerTitle>MEGA account</DrawerTitle>
            <DrawerDescription>
              {account.loggedIn
                ? 'Downloads use this account and its transfer quota.'
                : 'Without an account, MEGA limits how much you can download.'}
            </DrawerDescription>
          </DrawerHeader>
          {account.loggedIn ? (
            <LoggedIn account={account} onDone={() => onOpenChange(false)} />
          ) : (
            <LogInForm open={open} onDone={() => onOpenChange(false)} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function LoggedIn({
  account,
  onDone,
}: {
  account: Account;
  onDone: () => void;
}) {
  const logout = useApiMutation(() => expect(api.account.logout(), 200), {
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4 p-4">
      <p className="break-all rounded-md border px-3 py-2 text-sm">
        {account.email ?? 'Logged in'}
      </p>
      <Button
        variant="outline"
        className="h-11"
        disabled={logout.isPending}
        onClick={() => logout.mutate(undefined)}
      >
        {logout.isPending ? 'Logging out…' : 'Log out'}
      </Button>
    </div>
  );
}

function LogInForm({ open, onDone }: { open: boolean; onDone: () => void }) {
  const ids = { email: useId(), password: useId(), authCode: useId() };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authCode, setAuthCode] = useState('');

  // The password shouldn't still be there the next time it opens.
  useEffect(() => {
    if (!open) setPassword('');
  }, [open]);

  const login = useApiMutation(
    () =>
      expect(
        api.account.login({
          body: {
            email: email.trim(),
            password,
            ...(authCode.trim() ? { authCode: authCode.trim() } : {}),
          },
        }),
        200,
      ),
    { onSuccess: onDone },
  );

  return (
    <form
      className="grid gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate(undefined);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={ids.email}>Email</Label>
        <Input
          id={ids.email}
          type="email"
          autoComplete="username"
          autoCapitalize="off"
          className="h-11 text-base"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.password}>Password</Label>
        <Input
          id={ids.password}
          type="password"
          autoComplete="current-password"
          className="h-11 text-base"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.authCode}>
          Two-factor code{' '}
          <span className="font-normal text-muted-foreground">
            (if enabled)
          </span>
        </Label>
        <Input
          id={ids.authCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          className="h-11 text-base"
          value={authCode}
          onChange={(event) => setAuthCode(event.target.value)}
        />
      </div>
      <Button type="submit" className="h-11" disabled={login.isPending}>
        {login.isPending ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
