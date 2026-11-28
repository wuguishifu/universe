import Link from 'next/link';

import { Card, CardDescription, CardHeader, CardTitle } from '@libs/web-ui';

export default function Automation() {
  return (
    <main className="flex-1 h-screen flex flex-row justify-center items-center gap-4">
      <Link href="/libs/version-bump-workflow">
        <Card className="hover:scale-110 transition-all duration-300 w-64">
          <CardHeader className="flex flex-col items-center gap-4">
            <CardTitle>version-bump-workflow</CardTitle>
            <CardDescription className="w-full text-center">
              GitHub actions that help with automating releases and versioning.
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </main>
  );
}
