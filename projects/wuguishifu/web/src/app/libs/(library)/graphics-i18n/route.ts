import { redirect, RedirectType } from 'next/navigation';

export function GET() {
  return redirect('https://i18n.graphics', RedirectType.replace);
}
