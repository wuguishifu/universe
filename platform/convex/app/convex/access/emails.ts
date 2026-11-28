import { Email } from '@convex-dev/auth/providers/Email';
import { Resend } from '@convex-dev/resend';
import type { GenericActionCtx, GenericDataModel } from 'convex/server';

import { components } from '../_generated/api';

/**
 * The one-time codes Convex Auth emails (auth.ts): one to verify an address before its first
 * sign-in, one to reset a password. Sent through the Resend component, which needs RESEND_API_KEY,
 * from AUTH_EMAIL_FROM (e.g. `Universe <auth@example.com>`, on a domain verified in Resend).
 */
const resend = new Resend(components.resend, { testMode: false });

const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 15 * 60;

export const VerifyEmailOtp = otpProvider('email-otp', {
  subject: 'Verify your email',
  action: 'verify your email',
});

export const ResetPasswordOtp = otpProvider('password-reset-otp', {
  subject: 'Reset your password',
  action: 'reset your password',
});

function otpProvider(
  id: string,
  { subject, action }: { subject: string; action: string },
) {
  return Email({
    id,
    maxAge: CODE_TTL_SECONDS,
    generateVerificationToken: () => Promise.resolve(randomDigits(CODE_LENGTH)),
    // Convex Auth passes its action ctx as a second argument, which Auth.js's type leaves out.
    async sendVerificationRequest(
      { identifier: email, token },
      ctx?: GenericActionCtx<GenericDataModel>,
    ) {
      if (!ctx) {
        throw new Error(
          'Convex Auth did not pass a ctx to send the email with',
        );
      }
      const minutes = CODE_TTL_SECONDS / 60;
      await resend.sendEmail(ctx, {
        from: fromAddress(),
        to: email,
        subject,
        text: `Your code to ${action} is ${token}. It expires in ${minutes} minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Your code to ${action} is:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px;font-family:monospace">${token}</p><p>It expires in ${minutes} minutes. If you didn't ask for this, you can ignore this email.</p>`,
      });
    },
  });
}

function fromAddress(): string {
  const from = process.env.AUTH_EMAIL_FROM;
  if (!from) {
    throw new Error('AUTH_EMAIL_FROM is not set on this deployment');
  }
  return from;
}

/** Uniform random digits: bytes of 250 and up are dropped so `% 10` has no bias. */
function randomDigits(length: number): string {
  let digits = '';
  while (digits.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < 250 && digits.length < length) digits += String(byte % 10);
    }
  }
  return digits;
}
