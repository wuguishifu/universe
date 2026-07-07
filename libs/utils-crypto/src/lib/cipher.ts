import z from 'zod';

export const cipherSchema = z.object({
  v: z.literal(1),
  alg: z.string(),
  iv: z.string(),
  authTag: z.string(),
  ciphertext: z.string(),
});
export type Cipher = z.infer<typeof cipherSchema>;

export const createCipher = ({
  iv,
  authTag,
  ciphertext,
  alg,
}: {
  iv: string;
  authTag: string;
  ciphertext: string;
  alg: string;
}): string => {
  return JSON.stringify({
    v: 1,
    alg,
    iv,
    authTag,
    ciphertext,
  });
};

/**
 * @throws
 */
export const parseCipher = (cipher: string): Cipher => {
  return cipherSchema.parse(JSON.parse(cipher));
};
