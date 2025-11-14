import { MainColumn } from './components/MainColumn';
import { SideColumn } from './components/SideColumn';

export default function Index() {
  return (
    <main className="h-[300vh]">
      <div className="flex max-w-4xl mx-auto h-full mt-20 gap-4">
        <div className="flex-3">
          <MainColumn />
        </div>
        <div className="flex-1">
          <SideColumn />
        </div>
      </div>
    </main>
  );
}
