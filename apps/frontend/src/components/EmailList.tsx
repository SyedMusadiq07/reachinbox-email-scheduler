'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Star, Loader2 } from 'lucide-react';

export interface EmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  body?: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
}

interface EmailListProps {
  emails: EmailItem[];
  loading: boolean;
  emptyMessage: string;
}

function formatScheduleChip(email: EmailItem) {
  if (email.status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700 border border-green-200">
        Sent
      </span>
    );
  }
  if (email.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-red-50 text-red-700 border border-red-200">
        Failed
      </span>
    );
  }
  if (email.status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
        Processing
      </span>
    );
  }
  // scheduled
  const date = new Date(email.scheduledAt);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-orange-50 text-orange-700 border border-orange-200">
      <span className="w-3 h-3">⏰</span>
      {day} {time}
    </span>
  );
}

function getBodyPreview(body: string | undefined): string {
  if (!body) return '';
  // Strip HTML tags for preview
  const text = body.replace(/<[^>]*>/g, '').trim();
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

export default function EmailList({ emails, loading, emptyMessage }: EmailListProps) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {emails.map((email) => (
        <button
          key={email.id}
          onClick={() => router.push(`/dashboard/email/${email.id}`)}
          className="flex items-center gap-4 w-full px-6 py-3 text-left hover:bg-gray-50 transition-colors group"
        >
          {/* Recipient */}
          <span className="text-sm text-gray-900 w-[160px] shrink-0 truncate">
            To: {email.recipientEmail.split('@')[0]}
          </span>

          {/* Status chip */}
          <span className="shrink-0">{formatScheduleChip(email)}</span>

          {/* Subject + preview */}
          <span className="flex-1 min-w-0 truncate text-sm">
            <span className="font-medium text-gray-900">{email.subject}</span>
            {email.body && (
              <span className="text-gray-400">
                {' '}- {getBodyPreview(email.body)}
              </span>
            )}
          </span>

          {/* Star icon */}
          <Star className="w-4 h-4 text-gray-300 group-hover:text-gray-400 shrink-0 transition-colors" />
        </button>
      ))}
    </div>
  );
}
