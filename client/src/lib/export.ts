import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { type Booking, STATUS_LABEL, TRAILER_LABEL, fmtDate, fmtTime, minutes } from './format';

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const downloadCsv = (filename: string, headers: string[], rows: unknown[][]) => {
  const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
};

export const BOOKING_HEADERS = [
  'Date', 'Slot', 'Dock', 'Carrier', 'Truck', 'Driver', 'Driver phone', 'Direction', 'Trailer', 'Hazmat',
  'PO / ASN', 'Pallets', 'Status', 'Checked in', 'Arrival', 'Late (min)', 'Dock start', 'Completed', 'Turnaround (min)',
];

export const bookingRow = (b: Booking, tz: string) => [
  fmtDate(b.startTime, tz),
  `${fmtTime(b.startTime, tz)}-${fmtTime(b.endTime, tz)}`,
  b.dockId?.dockName ?? '',
  b.vendorId?.vendorCompany ?? '',
  b.truckNumber,
  b.driverName,
  b.driverPhone,
  b.direction,
  TRAILER_LABEL[b.trailerType] ?? b.trailerType,
  b.hazmat ? 'Yes' : 'No',
  b.referenceNumber ?? '',
  b.palletCount ?? '',
  STATUS_LABEL[b.status],
  b.checkedInAt ? fmtTime(b.checkedInAt, tz) : '',
  b.arrivalStatus === 'LATE' ? 'Late' : b.arrivalStatus === 'ON_TIME' ? 'On time' : '',
  b.lateByMinutes ?? '',
  b.dockStartedAt ? fmtTime(b.dockStartedAt, tz) : '',
  b.completedAt ? fmtTime(b.completedAt, tz) : '',
  minutes(b.checkedInAt, b.completedAt) ?? '',
];

export const exportBookingsCsv = (bookings: Booking[], tz: string, filename: string) =>
  downloadCsv(filename, BOOKING_HEADERS, bookings.map((b) => bookingRow(b, tz)));

/** A4 landscape PDF with a title block and one table. */
export const downloadPdfTable = (opts: {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  summary?: [string, string][];
}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(16);
  doc.text(opts.title, 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (opts.subtitle) doc.text(opts.subtitle, 40, 58);
  doc.text(`Generated ${new Date().toLocaleString()} · SmartDock`, 40, opts.subtitle ? 72 : 58);

  let startY = opts.subtitle ? 86 : 72;
  if (opts.summary?.length) {
    autoTable(doc, {
      startY,
      body: opts.summary,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 170 } },
      tableWidth: 420,
    });
    startY = (doc as any).lastAutoTable.finalY + 12;
  }

  autoTable(doc, {
    startY,
    head: [opts.headers],
    body: opts.rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [88, 28, 135] },
    alternateRowStyles: { fillColor: [245, 243, 255] },
  });
  doc.save(opts.filename);
};

export const exportBookingsPdf = (bookings: Booking[], tz: string, title: string, subtitle: string, filename: string) => {
  const headers = ['Slot', 'Dock', 'Carrier', 'Truck', 'Driver / phone', 'Load', 'PO / ASN', 'Pallets', 'Status', 'Arrival'];
  const rows = bookings.map((b) => [
    `${fmtDate(b.startTime, tz)} ${fmtTime(b.startTime, tz)}`,
    b.dockId?.dockName ?? '',
    b.vendorId?.vendorCompany ?? '',
    b.truckNumber,
    `${b.driverName}\n${b.driverPhone}`,
    `${b.direction === 'INBOUND' ? 'IN' : 'OUT'} · ${TRAILER_LABEL[b.trailerType] ?? b.trailerType}${b.hazmat ? ' · HAZMAT' : ''}`,
    b.referenceNumber ?? '',
    b.palletCount ?? '',
    STATUS_LABEL[b.status],
    b.arrivalStatus === 'LATE' ? `Late ${b.lateByMinutes}m` : b.arrivalStatus === 'ON_TIME' ? 'On time' : '',
  ]);
  downloadPdfTable({ filename, title, subtitle, headers, rows });
};
