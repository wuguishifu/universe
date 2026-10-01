import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch(
    'https://raw.githubusercontent.com/wuguishifu/gtools/main/install.sh',
  );
  const data = await response.text();
  return new NextResponse(data);
}
