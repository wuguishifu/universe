import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Snapshot } from '@projects/mega-client-contracts';
import { setSnapshot } from './use-live-snapshot';

/**
 * Every change answers with the snapshot it led to, which is shown straight away rather than
 * waiting for the stream. Failures are toasted.
 */
export function useApiMutation<Variables>(
  mutationFn: (variables: Variables) => Promise<Snapshot>,
  { onSuccess }: { onSuccess?: () => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (snapshot) => {
      setSnapshot(queryClient, snapshot);
      onSuccess?.();
    },
    onError: (error) => toast.error(error.message),
  });
}
