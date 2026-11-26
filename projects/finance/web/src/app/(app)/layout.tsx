import { cookies } from 'next/headers';

import { SidebarInset, SidebarProvider, TooltipProvider } from '@libs/ui-web';

import { AppSidebar } from '../../modules/layout/app-sidebar';

/** Everything behind sign-in: the sidebar is the app's navigation. */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The sidebar remembers whether it's collapsed in this cookie (see SidebarProvider).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
