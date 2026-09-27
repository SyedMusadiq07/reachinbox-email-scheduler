'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '../../../../lib/api';
import { ArrowLeft, Star, Archive, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext';

interface EmailDetail {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function EmailDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEmail = async () => {
      try {
        const res = await api.get(`/emails/${params.id}`);
        setEmail(res.data);
      } catch {
        setError('Email not found.');
      } finally {
        setLoading(false);
      }
    };
    fetchEmail();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-gray-400">{error ?? 'Email not found.'}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const senderName = user?.name ?? 'You';
  const senderEmail = user?.email ?? '';
  const date = new Date(email.sentAt ?? email.scheduledAt);
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1 text-gray-600 hover:text-black transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-medium text-gray-900 truncate">
            {email.subject}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Star className="w-4 h-4" />
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Archive className="w-4 h-4" />
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          {user?.avatarUrl && (
            <>
              <div className="w-px h-6 bg-gray-200 mx-1"></div>
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-8 h-8 rounded-full"
              />
            </>
          )}
        </div>
      </div>

      {/* Email content */}
      <div className="px-6 py-6">
        {/* Sender info */}
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium text-sm shrink-0">
            {senderName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{senderName}</span>
              <span className="text-sm text-gray-500">
                &lt;{senderEmail}&gt;
              </span>
            </div>
            <p className="text-sm text-gray-500">to {email.recipientEmail}</p>
          </div>
          <span className="text-sm text-gray-400 shrink-0">
            {formattedDate}, {formattedTime}
          </span>
        </div>

        {/* Status info */}
        {email.status === 'failed' && email.lastError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            <strong>Delivery failed:</strong> {email.lastError}
            {email.attempts > 0 && (
              <span className="text-red-500 ml-1">
                ({email.attempts} attempt{email.attempts !== 1 ? 's' : ''})
              </span>
            )}
          </div>
        )}

        {email.status === 'scheduled' && (
          <div className="mb-4 px-4 py-3 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
            <strong>Scheduled</strong> for{' '}
            {new Date(email.scheduledAt).toLocaleString()}
          </div>
        )}

        {/* Body */}
        <div
          className="prose prose-sm max-w-none text-gray-800"
          dangerouslySetInnerHTML={{ __html: email.body }}
        />

        {/* Provider message ID for debugging */}
        {email.providerMessageId && (
          <div className="mt-8 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Message ID: {email.providerMessageId}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
