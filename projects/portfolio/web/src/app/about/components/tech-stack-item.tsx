import { IconType } from '@icons-pack/react-simple-icons';
import { cn } from '@universe/ui-web';

export type TechStackProps = {
  href: string;
  Icon: IconType;
  iconClassName?: string;
  label: string;
};

export function TechStackItem({
  href,
  Icon,
  label,
  iconClassName,
}: TechStackProps) {
  return (
    <a
      className="cursor-pointer"
      href={href}
      target="_blank"
      tabIndex={-1}
      rel="noopener noreferrer"
    >
      <div className="flex flex-col items-center w-20">
        <Icon className={cn('size-16', iconClassName)} />
        <p className="text-sm select-none">{label}</p>
      </div>
    </a>
  );
}
