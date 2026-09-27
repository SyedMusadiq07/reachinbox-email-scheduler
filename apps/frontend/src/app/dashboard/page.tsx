'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '../../lib/api';
import EmailList, { type EmailItem } from '../../components/EmailList';

export default function ScheduledPage() {
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
            params: { q: searchQuery, status: 'scheduled' },
          });
          setEmails(res.data.items ?? []);
        } else {
          const res = await api.get('/emails', {
            params: { status: 'scheduled', pageSize: 50 },
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
      emptyMessage="No scheduled emails yet. Click Compose to get started."
    />
  );
}
