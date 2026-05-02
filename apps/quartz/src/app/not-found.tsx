import { buttonVariants } from '@universe/ui-web';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="h-screen w-screen absolute top-0 left-0 -z-50 gradient" />
      <div className="flex flex-col gap-6 max-w-81.5 md:max-w-141 items-center">
        <div className="w-full text-center flex flex-col gap-2">
          <h1>Oops! Page Not Found (404)</h1>
          <p className="large">Sorry! I haven&apos;t made this page yet!</p>
        </div>
        <Link href="/" className={buttonVariants({ variant: 'default' })}>
          <span className="button-span">Back Home</span>
        </Link>
      </div>
    </div>
  );
}
