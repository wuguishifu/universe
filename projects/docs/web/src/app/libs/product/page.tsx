import Link from 'next/link';

import { Card, CardDescription, CardHeader, CardTitle } from '@libs/web-ui';

export default function Product() {
  return (
    <main className="flex-1 h-screen flex flex-row justify-center items-center gap-4">
      <Link href="/libs/graphics-i18n">
        <Card className="hover:scale-110 transition-all duration-300 w-64">
          <CardHeader className="flex flex-col items-center gap-4">
            <CardTitle>graphics-i18n</CardTitle>
            <CardDescription className="w-full text-center">
              A series of libraries used for localizing/internationalizing
              graphics
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </main>
  );
}
