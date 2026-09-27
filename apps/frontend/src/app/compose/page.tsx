'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  X,
  Upload,
  Calendar,
  Loader2,
} from 'lucide-react';

interface Sender {
  id: string;
  email: string;
  displayName: string;
}

export default function ComposePage() {
  const router = useRouter();
  const { user } = useAuth();

  // Form state
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delayMs, setDelayMs] = useState(0);
  const [hourlyLimit, setHourlyLimit] = useState(0);
  const [sendAt, setSendAt] = useState<Date | null>(null);

  // UI state
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [scheduleDateInput, setScheduleDateInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Fetch senders
  const fetchSenders = async () => {
    try {
      const res = await api.get('/senders');
      const items = res.data.items ?? [];
      setSenders(items);
      if (items.length > 0 && !selectedSenderId) setSelectedSenderId(items[0].id);
    } catch {
      // no senders available
    }
  };

  useEffect(() => {
    fetchSenders();
  }, []);

  const handleAddSender = async () => {
    const email = window.prompt('Enter new sender email address:');
    if (!email) return;
    try {
      const res = await api.post('/senders', { email });
      const newSender = res.data;
      setSenders((prev) => [...prev, newSender]);
      setSelectedSenderId(newSender.id);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add sender');
    }
  };

  // Handle CSV/text file upload
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;

        // Parse emails: split by comma, newline, semicolon
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const found = text.match(emailRegex) ?? [];
        const normalized = found.map((e) => e.trim().toLowerCase());
        const unique = Array.from(new Set([...recipients, ...normalized]));
        setRecipients(unique);
      };
      reader.readAsText(file);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [recipients]
  );

  // Handle typing emails manually
  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      (e.key === 'Enter' || e.key === ',' || e.key === ' ') &&
      recipientInput.trim()
    ) {
      e.preventDefault();
      const email = recipientInput.trim().toLowerCase().replace(/,$/, '');
      if (email.includes('@') && !recipients.includes(email)) {
        setRecipients((prev) => [...prev, email]);
      }
      setRecipientInput('');
    }
    if (
      e.key === 'Backspace' &&
      !recipientInput &&
      recipients.length > 0
    ) {
      setRecipients((prev) => prev.slice(0, -1));
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  // Schedule presets
  const getPresets = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const t10 = new Date(tomorrow);
    t10.setHours(10, 0, 0, 0);

    const t11 = new Date(tomorrow);
    t11.setHours(11, 0, 0, 0);

    const t15 = new Date(tomorrow);
    t15.setHours(15, 0, 0, 0);

    return [
      { label: 'Tomorrow', date: tomorrow },
      { label: 'Tomorrow, 10:00 AM', date: t10 },
      { label: 'Tomorrow, 11:00 AM', date: t11 },
      { label: 'Tomorrow, 3:00 PM', date: t15 },
    ];
  };

  const handleScheduleDone = () => {
    if (scheduleDateInput) {
      setSendAt(new Date(scheduleDateInput));
    }
    setShowSchedulePanel(false);
  };

  const handleSend = async () => {
    if (!selectedSenderId || recipients.length === 0 || !subject || !body) {
      setError('Please fill in all required fields.');
      return;
    }

    // Read body from contentEditable if available
    const bodyContent = bodyRef.current?.innerHTML ?? body;

    const startTime = sendAt ?? new Date(Date.now() + 60_000); // default: 1 min from now

    setLoading(true);
    setError(null);
    try {
      await api.post(
        '/schedules',
        {
          senderId: selectedSenderId,
          recipients,
          subject,
          body: bodyContent,
          startTime: startTime.toISOString(),
          delayMs: delayMs * 1000, // convert seconds to ms
          hourlyLimit: hourlyLimit || 200,
        },
        {
          headers: {
            'Idempotency-Key': crypto.randomUUID(),
          },
        }
      );
      setSuccess(true);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error ?? 'Failed to schedule emails.'
          : 'Failed to schedule emails.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const selectedSender = senders.find((s) => s.id === selectedSenderId);
  const MAX_VISIBLE_CHIPS = 3;
  const visibleRecipients = recipients.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = recipients.length - MAX_VISIBLE_CHIPS;

  return (
    <div className="min-h-screen bg-white relative">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1 text-gray-600 hover:text-black transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-medium text-gray-900">
            Compose New Email
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors relative">
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSchedulePanel(!showSchedulePanel)}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Clock className="w-4 h-4" />
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="px-5 py-1.5 text-sm font-medium border border-green-500 text-green-600 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : sendAt ? (
              'Send Later'
            ) : (
              'Send'
            )}
          </button>
        </div>
      </div>

      {/* Success toast */}
      {success && (
        <div className="mx-6 mt-4 px-4 py-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          ✅ Emails scheduled successfully! Redirecting…
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex">
        {/* Form area */}
        <div className="flex-1 px-6 py-6">
          {/* From */}
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm text-gray-500 w-16 shrink-0">From</label>
            <div className="flex-1 flex gap-2">
              <select
                value={selectedSenderId}
                onChange={(e) => setSelectedSenderId(e.target.value)}
                className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:border-gray-400 transition-colors"
              >
                {senders.length === 0 && (
                  <option value="" disabled>No senders available</option>
                )}
                {senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.email}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddSender}
                title="Add Sender"
                className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded hover:bg-gray-100 transition-colors"
              >
                + Add
              </button>
            </div>
          </div>

          {/* To */}
          <div className="flex items-start gap-4 mb-4">
            <label className="text-sm text-gray-500 w-16 shrink-0 mt-2">
              To
            </label>
            <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[36px]">
              {visibleRecipients.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 border border-gray-300 rounded-full text-gray-700"
                >
                  {email}
                  <button
                    onClick={() => removeRecipient(email)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {hiddenCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs bg-gray-100 border border-gray-300 rounded-full text-gray-600">
                  +{hiddenCount}
                </span>
              )}
              <input
                type="text"
                placeholder={
                  recipients.length === 0 ? 'recipient@example.com' : ''
                }
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={handleRecipientKeyDown}
                className="flex-1 min-w-[150px] text-sm py-1 focus:outline-none placeholder-gray-400"
              />
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-sm text-green-600 hover:text-green-700 shrink-0 mt-1 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload List
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Subject */}
          <div className="flex items-center gap-4 mb-4 border-b border-gray-100 pb-4">
            <label className="text-sm text-gray-500 w-16 shrink-0">
              Subject
            </label>
            <input
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 text-sm py-1 focus:outline-none placeholder-gray-400"
            />
          </div>

          {/* Delay and Hourly Limit */}
          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">
                Delay between 2 emails
              </label>
              <input
                type="number"
                min="0"
                value={delayMs}
                onChange={(e) =>
                  setDelayMs(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-14 text-sm text-center border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-gray-400"
                placeholder="00"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Hourly Limit</label>
              <input
                type="number"
                min="0"
                value={hourlyLimit}
                onChange={(e) =>
                  setHourlyLimit(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-14 text-sm text-center border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-gray-400"
                placeholder="00"
              />
            </div>
          </div>

          {/* Rich text editor area */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50 text-gray-500 text-sm">
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={() =>
                  document.execCommand('bold')
                }
                title="Bold"
              >
                <strong>B</strong>
              </button>
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={() =>
                  document.execCommand('italic')
                }
                title="Italic"
              >
                <em>I</em>
              </button>
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={() =>
                  document.execCommand('underline')
                }
                title="Underline"
              >
                <u>U</u>
              </button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={() =>
                  document.execCommand('insertUnorderedList')
                }
                title="Bullet List"
              >
                •≡
              </button>
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={() =>
                  document.execCommand('insertOrderedList')
                }
                title="Numbered List"
              >
                1.
              </button>
            </div>

            {/* Content editable area */}
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              onInput={() =>
                setBody(bodyRef.current?.innerHTML ?? '')
              }
              className="min-h-[300px] p-4 text-sm text-gray-800 focus:outline-none"
              data-placeholder="Type Your Reply..."
              style={{
                position: 'relative',
              }}
            />
          </div>
        </div>

        {/* Send Later panel */}
        {showSchedulePanel && (
          <div className="w-[280px] border-l border-gray-200 p-4 shrink-0">
            <h3 className="text-base font-medium text-gray-900 mb-4">
              Send Later
            </h3>

            {/* Date/time picker */}
            <div className="mb-4">
              <div className="relative">
                <input
                  type="datetime-local"
                  value={scheduleDateInput}
                  onChange={(e) => setScheduleDateInput(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:border-gray-400 transition-colors"
                />
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-2 mb-6">
              {getPresets().map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setSendAt(preset.date);
                    setScheduleDateInput(
                      preset.date.toISOString().slice(0, 16)
                    );
                  }}
                  className="block w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 px-2 py-1.5 rounded transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                onClick={() => {
                  setShowSchedulePanel(false);
                  setSendAt(null);
                  setScheduleDateInput('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleDone}
                className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
