import Link from 'next/link';

import { Card, CardDescription, CardHeader, CardTitle } from '@libs/web-ui';

export default function NxGenerators() {
  return (
    <main className="flex-1 h-screen flex flex-row justify-center items-center gap-4">
      <Link href="/libs/nx-convex">
        <Card className="hover:scale-110 transition-all duration-300 w-64">
          <CardHeader className="flex flex-col items-center gap-4">
            <CardTitle>nx-convex</CardTitle>
            <CardDescription className="w-full text-center">
              Nx generators for adding Convex to your monorepo in an opinionated
              way
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/libs/nx-expo-native-modules">
        <Card className="hover:scale-110 transition-all duration-300 w-64">
          <CardHeader className="flex flex-col items-center gap-4">
            <CardTitle>nx-expo-native-modules</CardTitle>
            <CardDescription className="w-full text-center">
              Nx generators for adding an expo native module to your monorepo
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </main>
  );
}
