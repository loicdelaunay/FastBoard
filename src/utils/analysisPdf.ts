import { ref } from 'vue';
import { diffDays, formatDateShort, todayISO } from '@shared/dates';
import { ticketProgress } from '@shared/progress';
import type { TicketDTO } from '@shared/types';
import { t, intlLocale } from '@/i18n';
import { useAnalysis, type AnalysisScope } from '@/composables/useAnalysis';
import { useProjectStore } from '@/stores/project';
import { dueDate, isOverdue, ticketKey } from '@/utils/tickets';

/** Les polices PDF standard ne couvrent que le Latin-1 : on remplace les signes typographiques courants. */
function pdfText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/[—–]/g, '-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[  ]/g, ' ')
    .replace(/[^\u0000-ÿ]/g, '?');
}

type RGB = [number, number, number];
const INDIGO: RGB = [79, 70, 229];
const SLATE: RGB = [51, 65, 85];
const MUTED: RGB = [100, 116, 139];
const LINE: RGB = [226, 232, 240];
const GREEN: RGB = [34, 197, 94];
const AMBER: RGB = [245, 158, 11];
const RED: RGB = [239, 68, 68];
const TONES: Record<string, RGB> = { danger: RED, warn: AMBER, info: [14, 165, 233] };

const PAGE = { width: 210, height: 297, margin: 14 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/** Image JPEG d'un graphique Chart.js dessiné hors écran, sur fond blanc et en couleurs claires (lisible une fois imprimé). */
async function chartImage(config: Record<string, unknown>, width: number, height: number): Promise<string> {
  const { default: Chart } = await import('chart.js/auto');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const base = config.options as Record<string, unknown> | undefined;
  const chart = new Chart(canvas, {
    ...config,
    options: { animation: false, responsive: false, devicePixelRatio: 1, color: '#334155', ...base },
    plugins: [
      {
        id: 'whiteBackground',
        beforeDraw: (instance: { ctx: CanvasRenderingContext2D; width: number; height: number }) => {
          instance.ctx.save();
          instance.ctx.fillStyle = '#ffffff';
          instance.ctx.fillRect(0, 0, instance.width, instance.height);
          instance.ctx.restore();
        },
      },
    ],
  } as never);
  const image = canvas.toDataURL('image/jpeg', 0.92);
  chart.destroy();
  return image;
}

const axis = { ticks: { color: '#475569', font: { size: 15 } }, grid: { color: '#e2e8f0' } };
const legend = (position: string) => ({ position, labels: { color: '#334155', font: { size: 15 }, usePointStyle: true, boxWidth: 8, padding: 10 } });

function slug(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projet';
}

/**
 * Génère le rapport PDF de l'analyseur pour un périmètre (tout le projet ou une livraison) et le télécharge.
 * Tout est calculé côté navigateur, avec la même logique que l'écran « Analyseur ».
 */
export async function exportAnalysisPdf(scope: AnalysisScope): Promise<void> {
  const project = useProjectStore();
  const analysis = useAnalysis(ref(scope));
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableModule.default;

  const projectName = project.project?.name ?? 'FastBoard';
  const delivery = analysis.delivery.value;
  const scopeTitle = delivery ? t('Livraison « {name} »', { name: delivery.name }) : t('Ensemble du projet');
  const tickets = [...analysis.tickets.value].sort((a, b) => a.number - b.number);
  const today = analysis.today;
  const dateFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long', timeStyle: 'short' });

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: pdfText(`${projectName} - ${scopeTitle}`), subject: pdfText(t("Rapport d'analyse")), creator: 'FastBoard' });
  let y = 0;

  const ensure = (height: number): void => {
    if (y + height > PAGE.height - 16) {
      doc.addPage();
      y = PAGE.margin;
    }
  };
  const text = (value: string, x: number, at: number, options: { size?: number; bold?: boolean; color?: RGB; maxWidth?: number; align?: 'left' | 'right' | 'center' } = {}): number => {
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(options.size ?? 10);
    doc.setTextColor(...(options.color ?? SLATE));
    const lines = options.maxWidth ? doc.splitTextToSize(pdfText(value), options.maxWidth) : [pdfText(value)];
    doc.text(lines, x, at, { align: options.align ?? 'left' });
    return lines.length * ((options.size ?? 10) * 0.3528 * 1.25);
  };
  const heading = (title: string): void => {
    ensure(14);
    y += 3;
    text(title, PAGE.margin, y, { size: 12, bold: true });
    y += 1.5;
    doc.setDrawColor(...LINE);
    doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
    y += 5;
  };
  const progressBar = (x: number, at: number, width: number, value: number, marker: number | null): void => {
    doc.setFillColor(...LINE);
    doc.roundedRect(x, at, width, 3, 1.5, 1.5, 'F');
    if (value > 0) {
      doc.setFillColor(...INDIGO);
      doc.roundedRect(x, at, Math.max(3, (width * value) / 100), 3, 1.5, 1.5, 'F');
    }
    if (marker !== null) {
      doc.setDrawColor(...SLATE);
      doc.setLineWidth(0.4);
      doc.line(x + (width * marker) / 100, at - 1, x + (width * marker) / 100, at + 4);
      doc.setLineWidth(0.2);
    }
  };

  // --- En-tête -----------------------------------------------------------------------------------------------------
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, PAGE.width, 30, 'F');
  text(t("Rapport d'analyse"), PAGE.margin, 11, { size: 9, color: [199, 210, 254] });
  text(`${projectName}${project.project?.key ? `  (${project.project.key})` : ''}`, PAGE.margin, 19, { size: 18, bold: true, color: [255, 255, 255], maxWidth: CONTENT_WIDTH });
  text(scopeTitle, PAGE.margin, 26, { size: 11, color: [224, 231, 255] });
  text(t('Généré le {date}', { date: dateFormat.format(new Date()) }), PAGE.width - PAGE.margin, 26, { size: 8, color: [199, 210, 254], align: 'right' });
  y = 38;

  // --- Indicateurs -------------------------------------------------------------------------------------------------
  const byStatus = analysis.byStatus.value;
  const kpis: Array<{ label: string; value: string; tone?: RGB }> = [
    { label: t('Avancement global'), value: `${analysis.progress.value} %`, tone: INDIGO },
    { label: t('Tickets'), value: String(tickets.length) },
    { label: t('Terminés'), value: String(byStatus.done), tone: GREEN },
    { label: t('En cours'), value: String(byStatus.in_progress + byStatus.review), tone: INDIGO },
    { label: t('Bloqués'), value: String(byStatus.blocked), tone: byStatus.blocked ? RED : undefined },
    { label: t('En retard'), value: String(analysis.overdue.value.length), tone: analysis.overdue.value.length ? RED : undefined },
    { label: t('Sans responsable'), value: String(analysis.unassigned.value.length), tone: analysis.unassigned.value.length ? AMBER : undefined },
  ];
  const kpiWidth = (CONTENT_WIDTH - 3 * (kpis.length - 1)) / kpis.length;
  kpis.forEach((kpi, index) => {
    const x = PAGE.margin + index * (kpiWidth + 3);
    doc.setDrawColor(...LINE);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, kpiWidth, 18, 2, 2, 'FD');
    text(kpi.value, x + kpiWidth / 2, y + 8.5, { size: 15, bold: true, color: kpi.tone ?? SLATE, align: 'center' });
    text(kpi.label, x + kpiWidth / 2, y + 14, { size: 6.5, color: MUTED, align: 'center', maxWidth: kpiWidth - 2 });
  });
  y += 24;

  // --- Planning ----------------------------------------------------------------------------------------------------
  const period = analysis.period.value;
  if (period && analysis.theoretical.value !== null) {
    heading(t('Réel / théorique'));
    text(`${formatDateShort(period.start, true)} -> ${formatDateShort(period.end, true)}`, PAGE.margin, y, { size: 9, color: MUTED });
    const gap = analysis.gap.value ?? 0;
    const gapText = gap === 0 ? t('Dans les temps') : gap > 0 ? t("{gap} pts d'avance", { gap }) : t('{gap} pts de retard', { gap: -gap });
    text(gapText, PAGE.width - PAGE.margin, y, { size: 9, bold: true, color: gap >= 0 ? GREEN : gap > -10 ? AMBER : RED, align: 'right' });
    y += 5;
    text(t('Avancement réel'), PAGE.margin, y + 2.5, { size: 8, color: MUTED });
    progressBar(PAGE.margin + 42, y, CONTENT_WIDTH - 52, analysis.progress.value, analysis.theoretical.value);
    text(`${analysis.progress.value} %`, PAGE.width - PAGE.margin, y + 2.5, { size: 8, bold: true, align: 'right' });
    y += 6;
    text(t('Avancement théorique (temps écoulé)'), PAGE.margin, y + 2.5, { size: 8, color: MUTED });
    progressBar(PAGE.margin + 42, y, CONTENT_WIDTH - 52, analysis.theoretical.value, null);
    text(`${analysis.theoretical.value} %`, PAGE.width - PAGE.margin, y + 2.5, { size: 8, bold: true, align: 'right' });
    y += 6;
    const left = analysis.daysLeft.value;
    if (left !== null) {
      const remaining = left > 0 ? t('{n} jour restant|{n} jours restants', { n: left }) : left === 0 ? t("Échéance aujourd'hui") : t('Échéance dépassée de {n} jour|Échéance dépassée de {n} jours', { n: -left });
      text(remaining, PAGE.margin, y + 2.5, { size: 8, color: MUTED });
      y += 5;
    }
  }

  // --- Graphiques --------------------------------------------------------------------------------------------------
  if (tickets.length > 0) {
    heading(t('Graphiques'));
    const columns = project.visibleColumns;
    const burndown = analysis.burndown.value;
    const workload = analysis.workload.value;
    const categories = analysis.byCategory.value;
    const charts: Array<{ title: string; image: string; height: number }> = [];
    const W = 560;

    charts.push({
      title: t('Répartition par statut'),
      height: 230,
      image: await chartImage(
        {
          type: 'doughnut',
          data: { labels: columns.map((column) => pdfText(column.label)), datasets: [{ data: columns.map((column) => byStatus[column.status]), backgroundColor: columns.map((column) => column.color), borderColor: '#ffffff', borderWidth: 2 }] },
          options: { cutout: '58%', plugins: { legend: legend('right') } },
        },
        W,
        230,
      ),
    });
    charts.push({
      title: t('Reste à faire'),
      height: 230,
      image: await chartImage(
        {
          type: 'line',
          data: {
            labels: burndown.labels.map((day) => pdfText(formatDateShort(day))),
            datasets: [
              { label: pdfText(t('Idéal')), data: burndown.ideal, borderColor: '#94a3b8', borderDash: [6, 6], borderWidth: 2, pointRadius: 0, tension: 0 },
              { label: pdfText(t('Réel')), data: burndown.actual, borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.12)', fill: true, borderWidth: 3, pointRadius: 0, stepped: 'before', spanGaps: false },
            ],
          },
          options: {
            plugins: { legend: legend('bottom') },
            scales: { x: { ...axis, ticks: { ...axis.ticks, maxTicksLimit: 7, autoSkip: true } }, y: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } } },
          },
        },
        W,
        230,
      ),
    });
    const rows = Math.min(workload.length, 12);
    const workloadHeight = Math.max(190, rows * 30 + 90);
    charts.push({
      title: t('Charge par personne'),
      height: workloadHeight,
      image: await chartImage(
        {
          type: 'bar',
          data: {
            labels: workload.slice(0, rows).map((row) => pdfText(row.label)),
            datasets: [
              { label: pdfText(t('Terminés')), data: workload.slice(0, rows).map((row) => row.done), backgroundColor: '#22c55e' },
              { label: pdfText(t('En cours / à tester')), data: workload.slice(0, rows).map((row) => row.active), backgroundColor: '#4f46e5' },
              { label: pdfText(t('Bloqués')), data: workload.slice(0, rows).map((row) => row.blocked), backgroundColor: '#ef4444' },
              { label: pdfText(t('En attente')), data: workload.slice(0, rows).map((row) => row.waiting), backgroundColor: '#94a3b8' },
            ],
          },
          options: { indexAxis: 'y', plugins: { legend: legend('bottom') }, scales: { x: { ...axis, stacked: true, ticks: { ...axis.ticks, precision: 0 } }, y: { ...axis, stacked: true, grid: { display: false } } } },
        },
        W,
        workloadHeight,
      ),
    });
    if (categories.length) {
      const categoryHeight = Math.max(190, categories.length * 30 + 70);
      charts.push({
        title: t('Tickets par catégorie'),
        height: categoryHeight,
        image: await chartImage(
          {
            type: 'bar',
            data: { labels: categories.map((entry) => pdfText(entry.name)), datasets: [{ label: pdfText(t('Tickets')), data: categories.map((entry) => entry.count), backgroundColor: categories.map((entry) => entry.color), borderRadius: 6 }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } }, y: { ...axis, grid: { display: false } } } },
          },
          W,
          categoryHeight,
        ),
      });
    }

    // Deux graphiques par ligne ; la hauteur d'une ligne est celle du plus grand.
    const imageWidth = (CONTENT_WIDTH - 5) / 2;
    for (let i = 0; i < charts.length; i += 2) {
      const pair = charts.slice(i, i + 2);
      const heights = pair.map((chart) => (imageWidth * chart.height) / W);
      const rowHeight = Math.max(...heights) + 6;
      ensure(rowHeight + 2);
      pair.forEach((chart, index) => {
        const x = PAGE.margin + index * (imageWidth + 5);
        text(chart.title, x, y, { size: 8.5, bold: true, color: MUTED });
        doc.addImage(chart.image, 'JPEG', x, y + 2, imageWidth, heights[index]!);
      });
      y += rowHeight + 2;
    }
  }

  // --- Points de vigilance et priorités -----------------------------------------------------------------------------
  const alerts = analysis.alerts.value;
  heading(t('Points de vigilance'));
  if (!alerts.length) {
    text(t('Rien à signaler : le périmètre est sous contrôle.'), PAGE.margin, y, { size: 9, color: GREEN });
    y += 6;
  }
  for (const alert of alerts) {
    ensure(12);
    doc.setFillColor(...(TONES[alert.severity] ?? MUTED));
    doc.circle(PAGE.margin + 1.5, y - 1, 1.2, 'F');
    const used = text(alert.title, PAGE.margin + 5, y, { size: 9.5, bold: true });
    y += used + 0.5;
    y += text(alert.detail, PAGE.margin + 5, y, { size: 8.5, color: MUTED, maxWidth: CONTENT_WIDTH - 6 }) + 1;
    if (alert.tickets.length) {
      const keys = alert.tickets.slice(0, 12).map((ticket) => ticketKey(project.project, ticket)).join(', ');
      const more = alert.tickets.length > 12 ? `  +${alert.tickets.length - 12}` : '';
      y += text(`${keys}${more}`, PAGE.margin + 5, y, { size: 8, color: INDIGO, maxWidth: CONTENT_WIDTH - 6 }) + 1;
    }
    y += 2;
  }

  const tableDefaults = {
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: SLATE, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: INDIGO, textColor: [255, 255, 255] as RGB, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as RGB },
    margin: { left: PAGE.margin, right: PAGE.margin, bottom: 16 },
  };
  const lastY = (): number => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  const statusLabel = (ticket: TicketDTO): string => project.statusMeta(ticket.status).label;
  const dueOf = (ticket: TicketDTO): string => {
    const target = ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined;
    const due = dueDate(ticket, target);
    return due ? formatDateShort(due, true) : '';
  };

  const priorities = analysis.priorities.value;
  if (priorities.length) {
    heading(t('Tickets à surveiller en premier'));
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [[t('Clé'), t('Titre'), t('Statut'), t('Échéance'), t('Que faut-il faire ?')].map(pdfText)],
      body: priorities.map((item) => [ticketKey(project.project, item.ticket), item.ticket.title, statusLabel(item.ticket), dueOf(item.ticket), item.reasons.join(', ')].map(pdfText)),
      columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 26 }, 3: { cellWidth: 24 } },
    });
    y = lastY() + 4;
  }

  // --- Livraisons --------------------------------------------------------------------------------------------------
  if (!delivery && project.deliveries.length) {
    heading(t('Livraisons'));
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [[t('Livraison'), t('Période'), t('Tickets'), t('Progression'), t('Avancement théorique (temps écoulé)'), t('Écart'), t('En retard')].map(pdfText)],
      body: project.deliveries.map((item) => {
        const own = project.tickets.filter((ticket) => ticket.deliveryId === item.id);
        const progress = own.length ? Math.round(own.reduce((sum, ticket) => sum + ticketProgress(ticket), 0) / own.length) : 0;
        const total = diffDays(item.startDate, item.endDate) + 1;
        const theoretical = Math.min(100, Math.max(0, Math.round(((diffDays(item.startDate, today) + 1) / total) * 100)));
        const gap = own.length ? progress - theoretical : null;
        return [
          item.name,
          `${formatDateShort(item.startDate)} -> ${formatDateShort(item.endDate, true)}`,
          `${own.filter((ticket) => ticket.status === 'done').length} / ${own.length}`,
          `${progress} %`,
          `${theoretical} %`,
          gap === null ? '' : `${gap > 0 ? '+' : ''}${gap} pts`,
          String(own.filter((ticket) => isOverdue(ticket, item, today)).length),
        ].map(pdfText);
      }),
    });
    y = lastY() + 4;
  }

  // --- Liste des tickets -------------------------------------------------------------------------------------------
  heading(`${t('Tickets')} (${tickets.length})`);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [[t('Clé'), t('Titre'), t('Statut'), t('Assignés'), t('Progression'), t('Échéance')].map(pdfText)],
    body: tickets.map((ticket) =>
      [
        ticketKey(project.project, ticket),
        ticket.title,
        statusLabel(ticket),
        ticket.assignees.map((assignee) => project.usersById.get(assignee.userId)?.name ?? '').filter(Boolean).join(', '),
        `${ticketProgress(ticket)} %`,
        dueOf(ticket),
      ].map(pdfText),
    ),
    columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 24 }, 4: { cellWidth: 20 }, 5: { cellWidth: 24 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const color = project.statusMeta(tickets[data.row.index]!.status).color;
        data.cell.styles.textColor = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
      }
    },
  });

  // --- Pieds de page -----------------------------------------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...LINE);
    doc.line(PAGE.margin, PAGE.height - 11, PAGE.width - PAGE.margin, PAGE.height - 11);
    text(`FastBoard - ${projectName} - ${scopeTitle}`, PAGE.margin, PAGE.height - 6.5, { size: 7.5, color: MUTED, maxWidth: CONTENT_WIDTH - 30 });
    text(t('Page {page} / {pages}', { page, pages }), PAGE.width - PAGE.margin, PAGE.height - 6.5, { size: 7.5, color: MUTED, align: 'right' });
  }

  const file = `${slug(project.project?.key ?? projectName)}-${t('analyse')}-${delivery ? slug(delivery.name) : t('global')}-${todayISO()}.pdf`;
  doc.save(file);
}
