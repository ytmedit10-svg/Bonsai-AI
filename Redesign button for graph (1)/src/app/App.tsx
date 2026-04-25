import { GitBranch } from 'lucide-react';

export default function App() {
  return (
    <div className="size-full flex items-center justify-center bg-[#1a1a1a]">
      <button className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 hover:bg-white/10 hover:backdrop-blur-md hover:border hover:border-white/20">
        <GitBranch className="w-5 h-5 text-white" strokeWidth={2} />
      </button>
    </div>
  );
}