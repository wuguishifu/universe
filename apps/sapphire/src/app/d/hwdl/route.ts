import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch(
    'https://raw.githubusercontent.com/wuguishifu/homework-downloader/main/install.sh',
  );
  const data = await response.text();
  return new NextResponse(data);
}
