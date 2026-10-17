import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SNAPSHOT_KEY } from './use-live-snapshot';

/**
 * The stream pushes a snapshot after every change, so this only refetches in case it's down.
 * Failures are toasted.
 */
export function useApiMutation<Variables, Result>(
  mutationFn: (variables: Variables) => Promise<Result>,
  { onSuccess }: { onSuccess?: (result: Result) => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      onSuccess?.(result);
    },
    onError: (error) => toast.error(error.message),
  });
}
