import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Menu, MessageSquare, Users } from 'lucide-react';

import { loadPersisted, savePersisted } from '@/utils/persist';

import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sidebar } from './Sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { useDataStore } from '@/stores/dataStore';
import * as familyService from '@/services/family';
import type { Family } from '@/types';

const LAST_ROUTE_KEY = 'app:lastRoute';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isOpen: chatOpen, setOpen: setChatOpen } = useChatStore();
  const { user } = useAuthStore();

  const location = useLocation();
  const navigate = useNavigate();

  // On first mount, if we land on the index page restore the page the user was
  // last on. A refresh on a deep route (e.g. /transactions) keeps its URL and
  // skips this; the restore only kicks in on a fresh "/" landing (after login
  // or reopening the app).
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    if (location.pathname === '/') {
      const last = loadPersisted<string>(LAST_ROUTE_KEY, '/');
      if (last && last !== '/') navigate(last, { replace: true });
    }
  }, [location.pathname, navigate]);

  // Remember the current route so it can be restored next time.
  useEffect(() => {
    savePersisted(LAST_ROUTE_KEY, location.pathname);
  }, [location.pathname]);

  const [families, setFamilies] = useState<Family[]>([]);
  const [switching, setSwitching] = useState(false);
  const familiesRev = useDataStore((s) => s.familiesRev);

  useEffect(() => {
    familyService.listFamilies().then(setFamilies).catch(() => {});
  }, [familiesRev]);

  const currentFamily = families.find((f) => f.id === user?.default_family_id) ?? families[0];

  async function handleSwitchFamily(familyId: string) {
    if (familyId === user?.default_family_id) return;
    setSwitching(true);
    try {
      await familyService.switchDefaultFamily(familyId);
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden',
          'transition-[margin] duration-300 ease-in-out',
          chatOpen && 'md:mr-[400px]',
        )}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="size-5" />
            </Button>

            {families.length > 0 && (
              <Select
                value={currentFamily?.id ?? ''}
                onValueChange={handleSwitchFamily}
                disabled={switching}
              >
                <SelectTrigger className="h-9 w-auto min-w-[120px] font-medium">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-primary" />
                    <SelectValue placeholder="选择家庭" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {families.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setChatOpen(!chatOpen)}
            className={cn(chatOpen && 'bg-muted')}
            title="AI 助手"
          >
            <MessageSquare className="size-5" />
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <ChatSidebar />
    </div>
  );
}
