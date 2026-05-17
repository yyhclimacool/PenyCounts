import { useState } from 'react';
import { Outlet } from 'react-router';
import { Menu, MessageSquare } from 'lucide-react';

import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { Sidebar } from './Sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { QuickChatInput } from '@/components/chat/QuickChatInput';
import { useChatStore } from '@/stores/chatStore';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isOpen: chatOpen, setOpen: setChatOpen } = useChatStore();

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-[40%] -right-[20%] h-[80vh] w-[80vh] rounded-full bg-primary/5 blur-[100px]" />
        <div className="absolute -bottom-[30%] -left-[20%] h-[70vh] w-[70vh] rounded-full bg-accent/8 blur-[100px]" />
      </div>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between bg-card/60 glass px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="hidden lg:block" />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setChatOpen(!chatOpen)}
            className={cn(chatOpen && 'bg-muted')}
            title="AI 助手"
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <ChatSidebar />
      <QuickChatInput />
    </div>
  );
}
