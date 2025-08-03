import { NavbarDesktop } from './navbar-desktop';
import { NavbarMobile } from './navbar-mobile';

export function Navbar() {
  return (
    <>
      <div className="hidden lg:block">
        <NavbarDesktop />
      </div>
      <div className="lg:hidden">
        <NavbarMobile />
      </div>
    </>
  );
}
