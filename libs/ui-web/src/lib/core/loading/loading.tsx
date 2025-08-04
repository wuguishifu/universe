import { Spinner } from './spinner';

export function Loading() {
  return (
    <div className="w-full h-full flex justify-center items-center">
      <Spinner className="size-6" />
    </div>
  );
}
