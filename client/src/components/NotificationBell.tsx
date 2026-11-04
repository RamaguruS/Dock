import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  email: 'SENT' | 'SKIPPED' | 'FAILED';
  sms: 'SENT' | 'SKIPPED' | 'FAILED';
  createdAt: string;
}

interface NotificationResponse {
  notifications: Notification[];
  unread: number;
  channels: { email: boolean; sms: boolean };
}

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
};

export const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<NotificationResponse>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/api/notifications')).data,
    refetchInterval: 20000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/api/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 cursor-pointer"
        aria-label={`Notifications (${unread} unread)`}
      >
        <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-40">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div>
              <p className="text-sm font-bold">Notifications</p>
              <p className="text-[10px] text-slate-500">
                In-app · Email {data?.channels.email ? 'on' : 'off'} · SMS {data?.channels.sms ? 'on' : 'off'}
              </p>
            </div>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-xs text-purple-400 hover:text-purple-300 cursor-pointer">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-slate-800">
            {!data?.notifications.length && <li className="p-6 text-center text-sm text-slate-500">No notifications yet</li>}
            {data?.notifications.map((n) => (
              <li
                key={n._id}
                className={`px-4 py-3 text-sm cursor-pointer hover:bg-slate-800/50 ${n.read ? 'opacity-60' : ''}`}
                onClick={() => !n.read && markOne.mutate(n._id)}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-purple-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-100">{n.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {timeAgo(n.createdAt)}
                      {n.email === 'SENT' && ' · emailed'}
                      {n.sms === 'SENT' && ' · SMS sent'}
                      {(n.email === 'FAILED' || n.sms === 'FAILED') && ' · delivery failed'}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
