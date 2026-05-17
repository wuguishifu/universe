import { Content, isFilled } from '@prismicio/client';
import { FC } from 'react';
import { cn } from '@universe/ui-web';
import { RichText } from '../../components/text/text';
import { animation } from '../animation';
import { SliceComponentPropsWithContext } from '../context';

export type AboutTextProps = SliceComponentPropsWithContext<
  'about',
  Content.AboutTextSlice
>;

const AboutText: FC<AboutTextProps> = ({ slice, context }) => {
  const sliceIndex = context.sliceIds.indexOf(slice.id);
  const content = isFilled.richText(slice.primary.content)
    ? slice.primary.content
    : null;

  if (!content) return null;

  return (
    <section
      data-slice-type={slice.slice_type}
      data-slice-variation={slice.variation}
      className={cn('flex flex-col items-center w-full', animation(sliceIndex))}
    >
      <div className="max-w-5xl text-foreground text-lg py-2 text-left">
        <RichText content={content} />
      </div>
    </section>
  );
};

export default AboutText;
