'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import {
  Clock,
  Send,
  ChevronDown,
  LogOut,
  Search,
  Filter,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface SlackStatus {
  connected: boolean;
  integration: { teamName: string; channelName: string } | null;
}

interface EmailCounts {
  scheduled: number;
  sent: number;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [counts, setCounts] = useState<EmailCounts>({ scheduled: 0, sent: 0 });
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch email counts for sidebar badges
  useEffect(() => {
    if (!user) return;
    const fetchCounts = async () => {
      try {
        const [scheduledRes, sentRes] = await Promise.all([
          api.get('/emails', { params: { status: 'scheduled', pageSize: 1 } }),
          api.get('/emails', { params: { status: 'sent', pageSize: 1 } }),
        ]);
        setCounts({
          scheduled: scheduledRes.data.total ?? 0,
          sent: sentRes.data.total ?? 0,
        });
      } catch {
        // counts stay at 0
      }
    };
    fetchCounts();
  }, [user]);

  // Fetch Slack connection status
  useEffect(() => {
    if (!user) return;
    const fetchSlack = async () => {
      try {
        const res = await api.get('/integrations/slack');
        setSlackStatus(res.data);
      } catch {
        setSlackStatus({ connected: false, integration: null });
      }
    };
    fetchSlack();
  }, [user]);

  const handleSlackConnect = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/slack`;
  };

  const handleSlackDisconnect = async () => {
    try {
      await api.delete('/integrations/slack');
      setSlackStatus({ connected: false, integration: null });
    } catch {
      // silently fail
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/dashboard?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const isScheduled = pathname === '/dashboard' && !pathname.includes('/sent');
  const isSent = pathname === '/dashboard/sent';

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <aside className="w-[220px] border-r border-gray-200 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 pt-5 pb-3">
          <h1 className="text-2xl font-bold tracking-tight text-black" style={{ fontFamily: 'monospace' }}>
            ONB
          </h1>
        </div>

        {/* User block */}
        <div className="px-4 pb-3 relative">
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center gap-2 w-full p-1 rounded hover:bg-gray-50 transition-colors"
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-8 h-8 rounded-full shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-300 shrink-0 flex items-center justify-center text-xs font-medium text-gray-600">
                {user.name?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          </button>

          {userDropdownOpen && (
            <div className="absolute left-4 right-4 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <button
                onClick={() => {
                  setUserDropdownOpen(false);
                  logout();
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
        </div>

        {/* Compose button */}
        <div className="px-4 pb-4">
          <Link
            href="/compose"
            className="block w-full py-2 text-center text-sm font-medium text-green-600 border border-green-500 rounded hover:bg-green-50 transition-colors"
          >
            Compose
          </Link>
        </div>

        {/* Navigation */}
        <nav className="px-4 flex-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">
            Core
          </p>
          <Link
            href="/dashboard"
            className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors mb-1 ${
              isScheduled
                ? 'bg-gray-100 text-black font-medium'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="flex-1">Scheduled</span>
            <span className="text-xs text-gray-400">{counts.scheduled}</span>
          </Link>
          <Link
            href="/dashboard/sent"
            className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors mb-1 ${
              isSent
                ? 'bg-gray-100 text-black font-medium'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Send className="w-4 h-4" />
            <span className="flex-1">Sent</span>
            <span className="text-xs text-gray-400">{counts.sent}</span>
          </Link>
        </nav>

        {/* Slack Integration */}
        <div className="px-4 pb-4 mt-auto border-t border-gray-100 pt-3">
          {slackStatus?.connected ? (
            <div className="text-xs">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="font-medium text-gray-700">Slack Connected</span>
              </div>
              <p className="text-gray-500 truncate mb-2">
                #{slackStatus.integration?.channelName}
              </p>
              <button
                onClick={handleSlackDisconnect}
                className="text-red-500 hover:text-red-700 text-xs underline transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleSlackConnect}
              className="w-full py-2 text-center text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              Connect Slack
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="flex items-center gap-3 px-6 py-3 border-b border-gray-200">
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-gray-200 rounded focus:outline-none focus:border-gray-400 transition-colors"
              />
            </div>
          </form>
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Filter className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
