import Link from 'next/link';

import { Card, CardDescription, CardHeader, CardTitle } from '@libs/web-ui';

export default function Observability() {
  return (
    <main className="flex-1 h-screen flex flex-row justify-center items-center gap-4">
      <Link href="/libs/crash-observer">
        <Card className="hover:scale-110 transition-all duration-300 w-64">
          <CardHeader className="flex flex-col items-center gap-4">
            <CardTitle>crash-observer</CardTitle>
            <CardDescription className="w-full text-center">
              Unopinionated expo native module for capturing and logging native
              crashes to wherever your store your application logs
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </main>
  );
}
