export default function GameLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-6 pb-24">{children}</main>
  );
}
