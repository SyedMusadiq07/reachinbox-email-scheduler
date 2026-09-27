'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '../../../lib/api';
import EmailList, { type EmailItem } from '../../../components/EmailList';

export default function SentPage() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('search') ?? '';
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEmails = async () => {
      setLoading(true);
      try {
        if (searchQuery) {
          const res = await api.get('/emails/search', {
            params: { q: searchQuery, status: 'sent' },
          });
          setEmails(res.data.items ?? []);
        } else {
          const res = await api.get('/emails', {
            params: { status: 'sent,failed', pageSize: 50 },
          });
          setEmails(res.data.items ?? []);
        }
      } catch {
        setEmails([]);
      } finally {
        setLoading(false);
      }
    };
    fetchEmails();
  }, [searchQuery]);

  return (
    <EmailList
      emails={emails}
      loading={loading}
      emptyMessage="No sent emails yet."
    />
  );
}
