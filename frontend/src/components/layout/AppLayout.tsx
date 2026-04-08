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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-background px-4 lg:px-6">
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
